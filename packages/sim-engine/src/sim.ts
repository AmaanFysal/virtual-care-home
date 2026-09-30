// The simulation: builds the world from data and advances it one 5-second tick at a time
// (docs/03). Pure: no I/O, no wall clock, all randomness from seeded streams.

import { defaultTuning, type Tuning } from "./tuning.js";
import {
  DEFAULT_START_T,
  TICK_SECONDS,
  dayIndex,
  type AnySimEvent,
  type PersonView,
  type AdmissionCard,
  type DirectorConfig,
  type DirectorSettings,
  type Resident,
  type SimInput,
  type WorldData,
} from "@vch/shared-types";
import { validateData } from "./data/validate.js";
import { emit } from "./emit.js";
import { careMinute } from "./care.js";
import { applyDirectorEvents, applyInput, initDirector, planDirectorDay } from "./director/director.js";
import { ON_CALL_RN_ID, PARAMEDICS_ID, fallsMinute, staffFalls, watchFalls } from "./falls.js";
import { medsMinute } from "./meds.js";
import { planVisits, planWeek, visitorPerson, visitorsMinute, visitorsTick } from "./visitors.js";
import { floatMinute } from "./float.js";
import { breachCause, checkInvariants, checkServiceTargets, staffBusyCause } from "./invariants.js";
import { noteLoungeSupervision } from "./lounge.js";
import { healthMinute } from "./health.js";
import { infectionMinute } from "./infection.js";
import { initialNeeds, noAppetite, residentsMinute } from "./needs.js";
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
  /** The scenario director (docs/10). Off when absent: the run is exactly as without it. */
  director?: DirectorSettings;
  /**
   * data/director.json, for the rules the director triggers (cover, infection) when it's off, e.g.
   * a manual infection case from the admin panel. Ignored when `director` is given (its config is used).
   */
  config?: DirectorConfig;
  /** New residents' cards (data/personas/admissions.json); only reviewed ones move in. */
  admissions?: AdmissionCard[];
  /** Deaths and end-of-life decline (off for the public demo); `director.deaths` wins when given. Default on. */
  deaths?: boolean;
  /** Tuning rules to switch off for this run (docs/12; the tuning review). All on by default. */
  tuning?: Partial<Tuning>;
}

export interface Sim {
  readonly tick: number;
  readonly t: number;
  /** Advances one tick and returns the events it produced. */
  step(): AnySimEvent[];
  /** Queues an input; `applyTick` must be in the future. */
  enqueue(input: SimInput): void;
  people(): PersonView[];
  /** The turning points each person passed in the last tick (display only; see World.trail). */
  trail(): ReadonlyMap<string, readonly { x: number; y: number }[]>;
  /** Internal state, for tests and the inspector. Treat as read-only. */
  readonly world: World;
}

export function residentPerson(r: Resident, world: World): Person {
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
      needs: { ...initialNeeds(world.rng.needs), ...(noAppetite(r) ? { hunger: 0 } : {}) },
      asleep: true,
      inBed: true,
      requestId: null,
      busyTaskId: null,
      fluidsMlToday: 0,
      drinkLeftT: null,
      drinkStale: false,
      drinkOwed: false,
      wokeT: null,
      teaDone: false,
      toastDone: false,
      lastMouthCareT: world.startT - world.rng.needs.int(0, 60) * 60,
      loungeActivity: null,
      fall: null,
      postFallUntil: 0,
      away: null,
      returnT: null,
      leftForHospitalT: null,
      hospitalCause: null,
      recentReturnUntil: 0,
      illness: null,
      overrides: [],
      careBase: null,
      endOfLife: null,
      // Night checks already on schedule at the start (spec decision 13).
      lastCheckedT: world.startT - world.rng.needs.int(0, Math.floor(r.care.check_interval_mins.night / 2)) * 60,
      lastToiletT: world.startT - 60 * 60,
      lastTurnedT: world.startT - 10 * 60, // turned on the last night round
      morningDone: false,
      bedtimeDone: false,
      mealsServed: [],
    },
    visitor: null,
    infection: null,
  };
}

/** Short hash identifying the data a run was built from. */
export function dataVersion(data: WorldData): string {
  return hashString(JSON.stringify(data));
}

export function createSim(options: SimOptions): Sim {
  const { seed } = options;
  // The run keeps its own copy: residents can join (admissions) and their cards change (care
  // overrides after a hospital stay) without touching the caller's data.
  const data: WorldData = structuredClone(options.data);
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
    trail: new Map(),
    tasks: new Map(),
    taskSeq: 0,
    float: { status: "off", arriveT: null, planned: false },
    paramedics: [],
    loungeSeenT: startT,
    session: null,
    celebrations: [],
    onCallRn: { status: "off", arriveT: null, residentId: null },
    pendingRounds: [],
    mainCarer: { status: "off", arriveT: null, retryT: 0 },
    fallLog: [],
    metrics: { floatCallouts: 0, medInterruptions: 0 },
    shiftLog: new Map(data.residents.map((r) => [r.id, { falls: 0, lateOrMissedDoses: 0, helpRequests: 0, checksDone: 0 }])),
    failing: new Set(),
    rnOnCall: true,
    agencyCount: 0,
    inputs: [],
    director: null,
    config: options.director?.config ?? options.config ?? null,
    admissions: structuredClone(options.admissions ?? []),
    deaths: options.director?.deaths ?? options.deaths ?? true,
    tuning: defaultTuning(options.tuning),
    onsets: [],
    outbreaks: [],
    absences: [],
    pending: [],
    seq: 0,
  };

  for (const r of data.residents) addPerson(world, residentPerson(r, world));
  for (const s of data.staff) addPerson(world, staffPerson(s));
  const nf = data.rota.night_float;
  const float = staffPerson({ id: nf.id, name: nf.name, gender: nf.gender, walk_speed_mps: 1.2, role: "care_assistant", competencies: ["moving_handling"] });
  float.kind = "external";
  addPerson(world, float);
  const paramedics = staffPerson({ id: PARAMEDICS_ID, name: "Paramedic Crew", gender: "female", walk_speed_mps: 1.3, role: "care_assistant", competencies: [] });
  paramedics.kind = "external";
  paramedics.staff!.role = "paramedic";
  addPerson(world, paramedics);
  const onCall = staffPerson({ id: ON_CALL_RN_ID, name: "On-call Nurse", gender: "female", walk_speed_mps: 1.2, role: "registered_nurse", competencies: ["meds_trained", "fall_assessment", "moving_handling"] });
  onCall.kind = "external";
  onCall.initials = "RN";
  addPerson(world, onCall);
  for (const v of data.visitors) addPerson(world, visitorPerson(v));
  placeInitialStaff(world);
  planWeek(world, dayIndex(startT));
  planVisits(world, dayIndex(startT), startT);
  emit(world, "sim.started", [], { seed, startT, dataVersion: dataVersion(data) });
  if (options.director) {
    initDirector(world, options.director);
    planDirectorDay(world, startT);
  }

  const applyInputs = () => {
    while (world.inputs.length > 0 && world.inputs[0]!.applyTick <= world.tick) {
      const input = world.inputs.shift()!;
      applyInput(world, input.type, input.payload, input.source);
    }
    applyDirectorEvents(world);
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
      world.trail.clear();
      applyInputs();
      if (world.t % 60 === 0) {
        rotaMinute(world);
        if (world.director && world.t % 86400 === 0) planDirectorDay(world, world.t);
        infectionMinute(world);
        healthMinute(world);
        residentsMinute(world);
        careMinute(world);
        medsMinute(world);
        floatMinute(world);
        fallsMinute(world);
        visitorsMinute(world);
        staffFalls(world); // a fall nobody has reached comes before any other work
        decideStaff(world);
        sendIdleToPosts(world);
      }
      rotaLeaving(world);
      runTasks(world);
      staffFalls(world); // whoever has just finished goes to a fall nobody has reached
      const spawned = spawnWaiting(world);
      const arrived = moveAll(world);
      rotaArrivals(world, spawned, arrived);
      visitorsTick(world, spawned, arrived);
      noteLoungeSupervision(world);
      watchFalls(world);
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
    trail() {
      return world.trail;
    },
  };
}

/** Logs a hard violation or a service breach when it starts (not on every tick it continues). */
function logInvariants(world: World): void {
  const now = new Set<string>();
  for (const v of checkInvariants(world)) {
    const key = v.key ? `${v.rule}:${v.key}` : v.rule;
    now.add(key);
    if (!world.failing.has(key)) emit(world, "invariant.violated", [], { rule: v.rule, details: v.details });
  }
  for (const b of checkServiceTargets(world)) {
    const key = `${b.target}:${b.key}`;
    now.add(key);
    if (world.failing.has(key)) continue;
    const cause = breachCause(world);
    emit(world, "sla.breached", [b.residentId], { target: b.target, residentId: b.residentId, details: b.details, cause: b.cause ?? (cause === "no emergency" && b.target === "lounge_supervision" ? staffBusyCause(world) : cause) });
  }
  world.failing = now;
}

export function toView(p: Person): PersonView {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    initials: p.initials,
    gender: p.gender,
    ...(p.staff ? { role: p.staff.role } : {}),
    onMap: p.onMap,
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
    roomId: p.roomId,
    posture: p.posture,
    badges: [...p.badges],
    task: p.task,
    ...(p.resident ? { bedId: p.resident.data.room, away: p.resident.away } : {}),
    ...infectionView(p),
  };
}

/** The infection field of a person's view, only while it matters (so everyone else's view is unchanged). */
function infectionView(p: Person): Pick<PersonView, "infection"> {
  const inf = p.infection;
  if (!inf || (inf.recovered && !inf.isolated)) return {};
  const status = !inf.symptomatic ? "incubating" : !inf.recovered ? "symptomatic" : "recovering";
  return { infection: { disease: inf.disease, status, isolated: inf.isolated } };
}
