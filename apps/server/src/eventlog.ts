// Append-only SQLite log for one run (docs/07, ADR-0002). Only the server touches storage.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AnySimEvent, SimInput } from "@vch/shared-types";

export interface RunMeta {
  runId: string;
  seed: string;
  startT: number;
  dataVersion: string;
  /** Server metadata only; the engine never sees wall-clock time. */
  createdWallclock: string;
}

export class EventLog {
  private db: DatabaseSync;
  private insertEvent: StatementSync;
  private insertInput: StatementSync;
  private insertCommand: StatementSync;

  constructor(path: string, meta: RunMeta) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS run (run_id TEXT PRIMARY KEY, seed TEXT NOT NULL, start_t INTEGER NOT NULL, data_version TEXT NOT NULL, created_wallclock TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, tick INTEGER NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL, actors TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inputs (seq INTEGER PRIMARY KEY, apply_tick INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_type ON events(type);
    `);
    this.db
      .prepare("INSERT INTO run (run_id, seed, start_t, data_version, created_wallclock) VALUES (?, ?, ?, ?, ?)")
      .run(meta.runId, meta.seed, meta.startT, meta.dataVersion, meta.createdWallclock);
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

  close(): void {
    this.db.close();
  }
}
