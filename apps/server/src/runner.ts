// Hosts one simulation: paces it against real time, logs everything, and streams state to
// browsers (docs/08). The engine is the single writer; this class only calls step()/enqueue().

import {
  TICK_SECONDS,
  clockToSeconds,
  type AnySimEvent,
  type ClientCommand,
  type ClockSpeed,
  type ClockView,
  type PersonDetail,
  type PersonView,
  type ServerMessage,
  type SimInput,
  type WorldData,
} from "@vch/shared-types";
import type { Sim } from "@vch/sim-engine";
import type { EventLog } from "./eventlog.js";

/** How often deltas go out (10 Hz). */
export const FRAME_MS = 100;
/** Cap on ticks per frame so a stalled event loop can't cause a huge burst. */
const MAX_TICKS_PER_FRAME = 200;
const RECENT_EVENTS = 300;

export interface Client {
  send(message: ServerMessage): void;
}

export class Runner {
  private paused = true;
  private speed: ClockSpeed = 60;
  private accumulator = 0;
  private lastFrame: number | null = null;
  private clients = new Set<Client>();
  private recent: AnySimEvent[] = [];
  private unsent: AnySimEvent[] = [];
  private lastSent = new Map<string, string>();
  private inputSeq = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private sim: Sim,
    private data: WorldData,
    private log: EventLog,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.frame(performance.now()), FRAME_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  clock(): ClockView {
    return { t: this.sim.t, tick: this.sim.tick, paused: this.paused, speed: this.speed };
  }

  /** Advances the sim by as many ticks as real time and the speed allow, then sends a delta. */
  frame(now: number): void {
    const dt = this.lastFrame === null ? FRAME_MS : now - this.lastFrame;
    this.lastFrame = now;
    if (!this.paused) {
      this.accumulator += (dt / 1000) * (this.speed / TICK_SECONDS);
      const ticks = Math.min(Math.floor(this.accumulator), MAX_TICKS_PER_FRAME);
      this.accumulator = Math.min(this.accumulator - ticks, MAX_TICKS_PER_FRAME);
      this.advance(ticks);
    }
    this.broadcastDelta();
  }

  /** Runs ticks immediately (used by the pacer, `step`, and tests). */
  advance(ticks: number): void {
    const batch: AnySimEvent[] = [];
    for (let i = 0; i < ticks; i++) batch.push(...this.sim.step());
    if (batch.length === 0) return;
    this.log.appendEvents(batch);
    this.unsent.push(...batch);
    this.recent.push(...batch);
    if (this.recent.length > RECENT_EVENTS) this.recent.splice(0, this.recent.length - RECENT_EVENTS);
  }

  connect(client: Client): () => void {
    this.clients.add(client);
    client.send({ type: "snapshot", clock: this.clock(), floorplan: this.data.floorplan, people: this.sim.people(), events: [...this.recent] });
    return () => this.clients.delete(client);
  }

  private broadcastDelta(): void {
    const changed: PersonView[] = [];
    for (const view of this.sim.people()) {
      const json = JSON.stringify(view);
      if (this.lastSent.get(view.id) !== json) {
        this.lastSent.set(view.id, json);
        changed.push(view);
      }
    }
    if (changed.length === 0 && this.unsent.length === 0 && this.paused) return;
    const message: ServerMessage = { type: "delta", clock: this.clock(), people: changed, events: this.unsent };
    this.unsent = [];
    for (const client of this.clients) client.send(message);
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) client.send(message);
  }

  /** Applies a command from a browser. Returns a reply for that client only, if any. */
  handle(command: ClientCommand): ServerMessage | null {
    this.log.appendCommand(this.sim.tick, command.type, command);
    switch (command.type) {
      case "pause":
        this.paused = true;
        this.broadcast({ type: "clock", clock: this.clock() });
        return null;
      case "resume":
        this.paused = false;
        this.lastFrame = null;
        this.broadcast({ type: "clock", clock: this.clock() });
        return null;
      case "set_speed":
        this.speed = command.speed;
        this.broadcast({ type: "clock", clock: this.clock() });
        return null;
      case "step":
        if (!this.paused) return { type: "error", message: "Pause before stepping" };
        this.advance(1);
        this.broadcastDelta();
        return null;
      case "inject_fall": {
        const resident = this.data.residents.find((r) => r.id === command.residentId);
        if (!resident) return { type: "error", message: `Unknown resident ${command.residentId}` };
        this.inputSeq += 1;
        const input: SimInput<"inject_fall"> = {
          seq: this.inputSeq,
          applyTick: this.sim.tick + 1,
          type: "inject_fall",
          payload: { residentId: command.residentId, severity: command.severity },
          source: "user",
        };
        this.log.appendInput(input);
        this.sim.enqueue(input);
        return null;
      }
      case "inspect": {
        const detail = this.detail(command.personId);
        return detail ? { type: "detail", detail } : { type: "error", message: `Unknown person ${command.personId}` };
      }
    }
  }

  private detail(personId: string): PersonDetail | null {
    const person = this.sim.world.people.get(personId);
    if (!person) return null;
    const persona =
      this.data.residents.find((r) => r.id === personId) ??
      this.data.staff.find((s) => s.id === personId) ??
      this.data.visitors.find((v) => v.id === personId) ??
      { name: person.name, note: "Generated agency worker" };
    const schedule: { t: number; label: string }[] = [];
    const shift = person.staff?.shift;
    if (shift) {
      schedule.push({ t: shift.startT, label: `${shift.shift} shift starts (${shift.slot})` });
      schedule.push({ t: shift.endT, label: `${shift.shift} shift ends` });
    }
    const resident = this.data.residents.find((r) => r.id === personId);
    if (resident) {
      const dayStart = this.sim.t - (this.sim.t % 86400);
      const at = (clock: string | null, label: string) => clock && schedule.push({ t: dayStart + clockToSeconds(clock), label });
      at(resident.routine.wake, "Wake");
      for (const round of resident.medication_rounds) at(round, "Medication round");
      at(resident.routine.nap, "Nap");
      at(resident.routine.bed, "Bed");
    }
    const view = this.sim.people().find((p) => p.id === personId)!;
    const taskId = person.staff?.taskId ?? person.resident?.busyTaskId ?? null;
    const task = taskId ? this.sim.world.tasks.get(taskId) : undefined;
    if (person.staff?.breakDueT && !person.staff.breakTaken) schedule.push({ t: person.staff.breakDueT, label: "Break due" });
    schedule.sort((a, b) => a.t - b.t);
    return {
      person: view,
      persona,
      needs: person.resident ? { ...person.resident.needs } : null,
      workload: person.staff ? Math.round(person.staff.workload * 100) / 100 : null,
      currentTask: task?.label ?? person.task,
      btNode: task?.bt.node ?? null,
      schedule,
    };
  }
}

const SPEEDS: readonly number[] = [1, 10, 60, 360];

/** Parses and checks a raw WebSocket message. */
export function parseCommand(raw: string): ClientCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  switch (c.type) {
    case "pause":
    case "resume":
    case "step":
      return { type: c.type };
    case "set_speed":
      return SPEEDS.includes(c.speed as number) ? { type: "set_speed", speed: c.speed as ClockSpeed } : null;
    case "inspect":
      return typeof c.personId === "string" ? { type: "inspect", personId: c.personId } : null;
    case "inject_fall":
      return typeof c.residentId === "string" && (c.severity === "minor" || c.severity === "serious")
        ? { type: "inject_fall", residentId: c.residentId, severity: c.severity }
        : null;
    default:
      return null;
  }
}
