// The simulation: builds the world from data and advances it one 5-second tick at a time
// (docs/03). Pure: no I/O, no wall clock, all randomness from seeded streams.

import {
  DEFAULT_START_T,
  TICK_SECONDS,
  type AnySimEvent,
  type PersonView,
  type Resident,
  type SimInput,
  type WorldData,
} from "@vch/shared-types";
import { validateData } from "./data/validate.js";
import { emit } from "./emit.js";
import { careMinute } from "./care.js";
import { floatMinute } from "./float.js";
import { checkInvariants } from "./invariants.js";
import { initialNeeds, residentsMinute } from "./needs.js";
import { createStreams, hashString } from "./rng.js";
import { addPerson, initials, placeInitialStaff, rotaArrivals, rotaLeaving, rotaMinute, sendIdleToPosts, staffPerson } from "./rota.js";
import type { Person, World } from "./state.js";
import { decideStaff, runTasks } from "./tasks.js";
import { buildGrid } from "./world/grid.js";
import { moveAll, spawnWaiting } from "./world/movement.js";

export interface SimOptions {
  seed: string;
  data: WorldData;
  /** Sim seconds since Mon 2026-11-02 00:00; must be on a minute boundary. Default Tue 06:00. */
  startT?: number;
}

export interface Sim {
  readonly tick: number;
  readonly t: number;
  /** Advances one tick and returns the events it produced. */
  step(): AnySimEvent[];
  /** Queues an input; `applyTick` must be in the future. */
  enqueue(input: SimInput): void;
  people(): PersonView[];
  /** Internal state, for tests and the inspector. Treat as read-only. */
  readonly world: World;
}

function residentPerson(r: Resident, world: World): Person {
  const bed = world.points.get(r.room)!;
  const name = `${r.name.known_as} ${r.name.last}`;
  return {
    id: r.id,
    kind: "resident",
    name,
    initials: initials(name),
    gender: r.gender,
    speed: r.mobility.walk_speed_mps,
    onMap: true,
    x: bed.x,
    y: bed.y,
    roomId: bed.room,
    posture: "in_bed",
    badges: ["asleep"],
    task: null,
    move: null,
    atPoint: r.room,
    standCell: null,
    heldZone: null,
    waitingAtDoor: null,
    staff: null,
    resident: {
      data: r,
      needs: initialNeeds(world.rng.needs),
      asleep: true,
      inBed: true,
      requestId: null,
      busyTaskId: null,
      fluidsMlToday: 0,
      drinkLeft: false,
      // Night checks already on schedule at the start (spec decision 13).
      lastCheckedT: world.startT - world.rng.needs.int(0, Math.floor(r.care.check_interval_mins.night / 2)) * 60,
      lastToiletT: world.startT - 60 * 60,
      lastTurnedT: world.startT,
      morningDone: false,
      bedtimeDone: false,
      mealsServed: [],
    },
  };
}

/** Short hash identifying the data a run was built from. */
export function dataVersion(data: WorldData): string {
  return hashString(JSON.stringify(data));
}

export function createSim(options: SimOptions): Sim {
  const { seed, data } = options;
  const startT = options.startT ?? DEFAULT_START_T;
  if (startT % 60 !== 0) throw new Error("startT must be on a minute boundary");
  const errors = validateData(data);
  if (errors.length > 0) throw new Error(`Invalid data:\n${errors.join("\n")}`);

  const world: World = {
    seed,
    startT,
    tick: 0,
    t: startT,
    data,
    grid: buildGrid(data.floorplan),
    points: new Map(data.floorplan.points.map((p) => [p.id, p])),
    rng: createStreams(seed),
    people: new Map(),
    order: [],
    shifts: [],
    plannedDays: new Set(),
    spawnQueue: [],
    zoneOwner: new Map(),
    zoneReleasedTick: new Map(),
    standClaims: new Map(),
    tasks: new Map(),
    taskSeq: 0,
    float: { status: "off", arriveT: null, planned: false },
    metrics: { floatCallouts: 0 },
    shiftLog: new Map(data.residents.map((r) => [r.id, { falls: 0, lateOrMissedDoses: 0, helpRequests: 0, checksDone: 0 }])),
    failing: new Set(),
    rnOnCall: true,
    agencyCount: 0,
    inputs: [],
    pending: [],
    seq: 0,
  };

  for (const r of data.residents) addPerson(world, residentPerson(r, world));
  for (const s of data.staff) addPerson(world, staffPerson(s));
  const nf = data.rota.night_float;
  const float = staffPerson({ id: nf.id, name: nf.name, gender: nf.gender, walk_speed_mps: 1.2, role: "care_assistant", competencies: ["moving_handling"] });
  float.kind = "external";
  addPerson(world, float);
  placeInitialStaff(world);
  emit(world, "sim.started", [], { seed, startT, dataVersion: dataVersion(data) });

  const applyInputs = () => {
    while (world.inputs.length > 0 && world.inputs[0]!.applyTick <= world.tick) {
      const input = world.inputs.shift()!;
      if (input.type === "inject_fall") {
        const { residentId, severity } = (input as SimInput<"inject_fall">).payload;
        const resident = world.people.get(residentId);
        if (!resident || resident.kind !== "resident" || !resident.onMap) continue;
        // Phase 1 M2: the fall is recorded; the response procedure arrives in M5.
        resident.posture = "on_floor";
        resident.badges = ["alert"];
        emit(world, "resident.fell", [residentId], { residentId, severity, roomId: resident.roomId ?? "" }, input.source);
      }
    }
  };

  return {
    get tick() {
      return world.tick;
    },
    get t() {
      return world.t;
    },
    world,
    step() {
      world.tick += 1;
      world.t = startT + world.tick * TICK_SECONDS;
      applyInputs();
      if (world.t % 60 === 0) {
        rotaMinute(world);
        residentsMinute(world);
        careMinute(world);
        floatMinute(world);
        decideStaff(world);
        sendIdleToPosts(world);
      }
      rotaLeaving(world);
      runTasks(world);
      const spawned = spawnWaiting(world);
      const arrived = moveAll(world);
      rotaArrivals(world, spawned, arrived);
      logInvariants(world);
      const events = world.pending;
      world.pending = [];
      return events;
    },
    enqueue(input) {
      if (input.applyTick <= world.tick) throw new Error(`Input ${input.seq} applies at tick ${input.applyTick}, but the sim is at ${world.tick}`);
      world.inputs.push(input);
      world.inputs.sort((a, b) => a.applyTick - b.applyTick || a.seq - b.seq);
    },
    people() {
      return world.order.map((id) => toView(world.people.get(id)!));
    },
  };
}

/** Logs a violation when a rule starts failing (not on every tick it stays failing). */
function logInvariants(world: World): void {
  const now = new Map(checkInvariants(world).map((v) => [v.key ? `${v.rule}:${v.key}` : v.rule, v]));
  for (const [key, v] of now) {
    if (!world.failing.has(key)) emit(world, "invariant.violated", [], { rule: v.rule, details: v.details });
  }
  world.failing = new Set(now.keys());
}

export function toView(p: Person): PersonView {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    initials: p.initials,
    onMap: p.onMap,
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
    roomId: p.roomId,
    posture: p.posture,
    badges: [...p.badges],
    task: p.task,
  };
}
