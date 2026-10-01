// Append-only SQLite log for one run (docs/07, ADR-0002). Only the server touches storage. On the
// public server (docs/13) old events are pruned to bound the file, and a run resumed from a
// snapshot cuts the log back to the snapshot's tick; inputs and commands are always kept.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AnySimEvent, SimInput } from "@vch/shared-types";

export interface RunMeta {
  runId: string;
  seed: string;
  startT: number;
  dataVersion: string;
  /** Server metadata only; the engine never sees wall-clock time. */
  createdWallclock: string;
  /**
   * The director settings needed to replay the run (docs/10): mode, scenario id and a hash of its
   * file, a hash of data/director.json, and the deaths switch. "off" when it's off.
   */
  director?: string;
}

export class EventLog {
  private db: DatabaseSync;
  private insertEvent: StatementSync;
  private insertInput: StatementSync;
  private insertCommand: StatementSync;

  /** Opens (or creates) a run's log; `resume` reopens an existing one without adding its run row again. */
  constructor(path: string, meta: RunMeta, options: { resume?: boolean } = {}) {
    this.db = new DatabaseSync(path);
    // Before any table exists, so pruned pages can be handed back to the disk (prune).
    if (!options.resume) this.db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS run (run_id TEXT PRIMARY KEY, seed TEXT NOT NULL, start_t INTEGER NOT NULL, data_version TEXT NOT NULL, created_wallclock TEXT NOT NULL, director TEXT NOT NULL DEFAULT 'off');
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, tick INTEGER NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL, actors TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inputs (seq INTEGER PRIMARY KEY, apply_tick INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_type ON events(type);
    `);
    if (!options.resume)
      this.db
        .prepare("INSERT INTO run (run_id, seed, start_t, data_version, created_wallclock, director) VALUES (?, ?, ?, ?, ?, ?)")
        .run(meta.runId, meta.seed, meta.startT, meta.dataVersion, meta.createdWallclock, meta.director ?? "off");
    this.insertEvent = this.db.prepare("INSERT INTO events (seq, tick, t, type, actors, payload, source) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.insertInput = this.db.prepare("INSERT INTO inputs (seq, apply_tick, type, payload, source) VALUES (?, ?, ?, ?, ?)");
    this.insertCommand = this.db.prepare("INSERT INTO commands (tick, type, payload) VALUES (?, ?, ?)");
  }

  /** Writes a batch of events in one transaction. */
  appendEvents(events: AnySimEvent[]): void {
    if (events.length === 0) return;
    this.db.exec("BEGIN");
    try {
      for (const e of events) {
        this.insertEvent.run(e.seq, e.tick, e.t, e.type, JSON.stringify(e.actors), JSON.stringify(e.payload), e.source);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  appendInput(input: SimInput): void {
    this.insertInput.run(input.seq, input.applyTick, input.type, JSON.stringify(input.payload), input.source);
  }

  appendCommand(tick: number, type: string, payload: unknown): void {
    this.insertCommand.run(tick, type, JSON.stringify(payload ?? {}));
  }

  /**
   * Cuts the log back to a snapshot at `tick` (resuming after a crash): later events and commands
   * go, and inputs logged after the snapshot (seq above `inputSeq`), which the restored world never
   * received. Inputs queued before it for a later tick stay: the snapshot holds them too.
   */
  truncateAfter(tick: number, inputSeq: number): { events: number; inputs: number; commands: number } {
    const events = Number(this.db.prepare("DELETE FROM events WHERE tick > ?").run(tick).changes);
    const inputs = Number(this.db.prepare("DELETE FROM inputs WHERE seq > ?").run(inputSeq).changes);
    const commands = Number(this.db.prepare("DELETE FROM commands WHERE tick > ?").run(tick).changes);
    return { events, inputs, commands };
  }

  /** Deletes events before sim time `beforeT` and returns the freed pages to the disk. */
  prune(beforeT: number): number {
    const removed = Number(this.db.prepare("DELETE FROM events WHERE t < ?").run(beforeT).changes);
    if (removed > 0) this.db.exec("PRAGMA incremental_vacuum;");
    return removed;
  }

  /** The last `n` events, oldest first (for the snapshot a browser gets after a restart). */
  tail(n: number): AnySimEvent[] {
    const rows = this.db.prepare("SELECT seq, tick, t, type, actors, payload, source FROM events ORDER BY seq DESC LIMIT ?").all(n) as {
      seq: number;
      tick: number;
      t: number;
      type: string;
      actors: string;
      payload: string;
      source: string;
    }[];
    return rows.reverse().map((r) => ({ id: `e${r.seq}`, seq: r.seq, tick: r.tick, t: r.t, type: r.type, actors: JSON.parse(r.actors), payload: JSON.parse(r.payload), source: r.source }) as AnySimEvent);
  }

  close(): void {
    this.db.close();
  }
}
