// Snapshots on disk and resuming after a restart (ADR-0008, docs/13). Each run has a folder,
// RUNS_DIR/<runId>/, holding its event log (events.sqlite) and its latest snapshots
// (snap-<tick>.v8.gz: the engine's snapshot plus the runner's input counter, through v8's
// serialiser and gzip). A restart with the same engine build, data and director settings resumes
// the latest snapshot; anything else starts a fresh run on the next day's date.

import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import { gunzipSync, gzipSync } from "node:zlib";
import { SECONDS_PER_DAY } from "@vch/shared-types";
import type { SimSnapshot } from "@vch/sim-engine";

/** Snapshots kept per run, newest first. */
export const KEEP_SNAPSHOTS = 3;
/** Bumped if the file layout of a saved state changes. */
export const SAVE_FORMAT = 1;

export interface SnapshotHeader {
  format: typeof SAVE_FORMAT;
  runId: string;
  tick: number;
  /** Sim time of the snapshot. */
  t: number;
  seed: string;
  startT: number;
  /** Hash of the engine's and shared types' source: a different build starts a fresh run. */
  engineBuild: string;
  /** The data files' version when the run began (the run's own copy may since have changed). */
  dataVersion: string;
  /** The director settings the run was started with (as recorded in its log). */
  director: string;
  /** Node version that wrote it (for the record; v8's format reads older versions). */
  node: string;
  savedWallclock: string;
}

export interface SavedState {
  header: SnapshotHeader;
  sim: SimSnapshot;
  /** The runner's last input sequence number, so inputs logged after a restore don't reuse one. */
  inputSeq: number;
}

/** What a fresh process would be built from now: compared with a snapshot's header to resume it. */
export interface Identity {
  engineBuild: string;
  dataVersion: string;
  director: string;
  seed: string;
}

export function runDir(runsDir: string, runId: string): string {
  return join(runsDir, runId);
}

/** Writes a snapshot atomically (temp file, fsync, rename), then keeps only the newest few. */
export function writeSnapshot(dir: string, state: SavedState): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `snap-${String(state.header.tick).padStart(10, "0")}.v8.gz`);
  const tmp = `${file}.tmp`;
  const bytes = gzipSync(serialize(state), { level: 6 });
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  for (const old of snapshotFiles(dir).slice(KEEP_SNAPSHOTS)) rmSync(join(dir, old), { force: true });
  return file;
}

/** A run folder's snapshot files, newest first. */
function snapshotFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^snap-\d+\.v8\.gz$/.test(f))
    .sort()
    .reverse();
}

export function readSnapshot(file: string): SavedState {
  const state = deserialize(gunzipSync(readFileSync(file))) as SavedState;
  if (state?.header?.format !== SAVE_FORMAT || !state.sim) throw new Error(`${file} isn't a saved state of format ${SAVE_FORMAT}`);
  return state;
}

/** Run folders, newest first (run ids start with their creation time). */
export function runFolders(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
    .map((d) => d.name)
    .sort()
    .reverse();
}

/**
 * The newest readable snapshot of the newest run that has one. A file that can't be read (cut
 * short by a crash, say) is skipped for the one before it; `skipped` says which and why.
 */
export function latestSnapshot(runsDir: string): { runId: string; file: string; state: SavedState; skipped: string[] } | null {
  const skipped: string[] = [];
  for (const runId of runFolders(runsDir)) {
    const dir = runDir(runsDir, runId);
    for (const f of snapshotFiles(dir)) {
      try {
        return { runId, file: join(dir, f), state: readSnapshot(join(dir, f)), skipped };
      } catch (err) {
        skipped.push(`${runId}/${f}: ${(err as Error).message}`);
      }
    }
  }
  return null;
}

/**
 * Resume the snapshot, or start a fresh run (and when): a fresh run starts at 06:00 on the day
 * after the snapshot's sim date, so the clock carries on (project owner, 2026-10-01).
 */
export function resumeDecision(header: SnapshotHeader, now: Identity): { resume: true } | { resume: false; reason: string; startT: number } {
  const reasons: string[] = [];
  if (header.engineBuild !== now.engineBuild) reasons.push("the engine has changed");
  if (header.dataVersion !== now.dataVersion) reasons.push("the data has changed");
  if (header.director !== now.director) reasons.push("the director settings have changed");
  if (header.seed !== now.seed) reasons.push("the seed has changed");
  if (reasons.length === 0) return { resume: true };
  return { resume: false, reason: reasons.join(", "), startT: nextMorning(header.t) };
}

/** 06:00 on the day after sim time `t`. */
export function nextMorning(t: number): number {
  return (Math.floor(t / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY + 6 * 3600;
}

/** Deletes all but the newest `keep` run folders (the current run is always kept). */
export function pruneRuns(runsDir: string, keep: number, current: string): string[] {
  const removed: string[] = [];
  for (const runId of runFolders(runsDir).filter((r) => r !== current).slice(Math.max(0, keep - 1))) {
    rmSync(runDir(runsDir, runId), { recursive: true, force: true });
    removed.push(runId);
  }
  return removed;
}

/** A hash of the engine's and shared types' source files: any change to how the world runs changes it. */
export function engineBuild(): string {
  const hash = createHash("sha256");
  for (const pkg of ["../../../packages/sim-engine/src/", "../../../packages/shared-types/src/"]) {
    const root = fileURLToPath(new URL(pkg, import.meta.url));
    for (const file of walk(root)) {
      hash.update(file.slice(root.length));
      hash.update(readFileSync(file));
    }
  }
  return hash.digest("hex").slice(0, 12);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}
