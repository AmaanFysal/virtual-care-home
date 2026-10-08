// The activity export (docs/workstreams/activity-export/spec.md): the files match the world
// description, are complete and deterministic, and the committed sample is written again byte for byte.
// After a change to the engine's behaviour or the export's schema, write the sample again and review the diff:
//   pnpm --filter @vch/sim-engine export --seed 1 --hours 2 --every 5m --no-gzip --out packages/sim-engine/test/fixtures/export-sample

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { TICK_SECONDS, type AnySimEvent } from "@vch/shared-types";
import { STREAMS, createSim, csvLine, exportRun, isoTime, roomsJson, type StreamName } from "../src/index.js";
import { activityRows } from "../src/export.js";
import { loadAdmissions, loadWorldData } from "../tools/load-data.js";

const data = loadWorldData();
const pkg = fileURLToPath(new URL("..", import.meta.url));
const sample = join(pkg, "test/fixtures/export-sample/seed-1-2026-11-03-2h");
const tmp = mkdtempSync(join(tmpdir(), "vch-export-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cli(args: string[], out: string): string {
  execFileSync(join(pkg, "node_modules/.bin/tsx"), ["scripts/export.ts", ...args, "--out", out], { cwd: pkg, stdio: "pipe" });
  const [dir] = readdirSync(out);
  return join(out, dir!);
}

/** A CSV file's rows as cell arrays (quoted cells allowed), header first. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.trimEnd().split("\n")) {
    const cells: string[] = [];
    let cell = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quoted && c === '"' && line[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) cells.push(cell), (cell = "");
      else cell += c;
    }
    rows.push([...cells, cell]);
  }
  return rows;
}

/** Exports `hours` of a run in memory: each stream's lines, header first. */
function exportInMemory(seed: string, hours: number, everySeconds: number) {
  const sim = createSim({ seed, data, admissions: loadAdmissions() });
  const lines = Object.fromEntries(Object.keys(STREAMS).map((k) => [k, [] as string[]])) as Record<StreamName, string[]>;
  const rows = exportRun(sim, { endT: sim.t + hours * 3600, everySeconds }, (stream, line) => lines[stream].push(line));
  return { sim, lines, rows, parsed: (s: StreamName) => parse(lines[s].join("\n")).slice(1) };
}

describe("the activity export", () => {
  it("writes the committed sample again, byte for byte", () => {
    const dir = cli(["--seed", "1", "--hours", "2", "--every", "5m", "--no-gzip"], join(tmp, "plain"));
    const files = readdirSync(sample).sort();
    expect(readdirSync(dir).sort()).toEqual(files);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8"), f).toBe(readFileSync(join(sample, f), "utf8"));
  }, 60000);

  it("gzips by default, with the same rows as plain CSV", () => {
    const dir = cli(["--seed", "1", "--hours", "2", "--every", "5m"], join(tmp, "gzip"));
    for (const stream of Object.keys(STREAMS)) expect(gunzipSync(readFileSync(join(dir, `${stream}.csv.gz`))).toString("utf8"), stream).toBe(readFileSync(join(sample, `${stream}.csv`), "utf8"));
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).gzip).toBe(true);
  }, 60000);

  it("has a header for each file that matches the manifest, and counts every row", () => {
    const manifest = JSON.parse(readFileSync(join(sample, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ exportSchema: 1, worldSchema: 1, seed: "1", sampleSeconds: 300, gzip: false, startTime: "2026-11-03T06:00:00", endTime: "2026-11-03T08:00:00" });
    for (const [stream, columns] of Object.entries(STREAMS)) {
      const rows = parse(readFileSync(join(sample, `${stream}.csv`), "utf8"));
      expect(rows[0], stream).toEqual([...columns]);
      expect(manifest.files[`${stream}.csv`]).toEqual({ rows: rows.length - 1, columns: [...columns] });
    }
  });

  it("matches the world description at every sample, and every touch and event of the run", () => {
    const { lines, parsed } = exportInMemory("2", 3, 60);
    const twin = createSim({ seed: "2", data, admissions: loadAdmissions() });
    const endT = twin.t + 3 * 3600;
    const expected = { people: [] as string[], doors: [] as string[], windows: [] as string[], equipment: [] as string[], touches: [] as string[], events: [] as AnySimEvent[] };
    while (twin.t < endT) {
      if (twin.t % 60 === 0) {
        const d = twin.describe();
        const at = `${d.t},${isoTime(d.t)}`;
        for (const p of d.people) expected.people.push(`${at},${p.personId},${p.kind},${p.roomId},${p.x},${p.y},${p.activity},${p.met},${p.intensity},${p.book},${p.code},`);
        for (const x of d.doors) expected.doors.push(`${at},${x.doorId},${x.state},${x.heldBy ?? ""}`);
        for (const x of d.windows) expected.windows.push(`${at},${x.windowId},${x.roomId},${x.state},${x.openingMm}`);
        for (const x of d.equipment) expected.equipment.push(`${at},${x.equipmentId},${x.kind},${x.roomId},${x.on},${x.level ?? ""},${x.setpointC ?? ""}`);
      }
      expected.events.push(...twin.step());
      for (const x of twin.world.building!.touches) expected.touches.push(`${x.t},${isoTime(x.t)},${x.personId},${x.objectId}`);
    }
    // People rows end with the infection columns, which the description doesn't have.
    expect(lines.people.slice(1).map((l) => l.split(",").slice(0, 12).join(",") + ",")).toEqual(expected.people);
    expect(lines.doors.slice(1)).toEqual(expected.doors);
    expect(lines.windows.slice(1)).toEqual(expected.windows);
    expect(lines.equipment.slice(1)).toEqual(expected.equipment);
    expect(lines.touches.slice(1).map((l) => l.split(",").slice(0, 4).join(","))).toEqual(expected.touches);
    expect(parsed("events").map((r) => `${r[2]} ${r[3]} ${r[4]}`)).toEqual(expected.events.map((e) => `${e.seq} ${e.type} ${e.source}`));
    expect(expected.touches.length).toBeGreaterThan(0);
  }, 60000);

  it("has a row for everyone on the map and for every door, window and item at each sample, and weather each hour", () => {
    const { sim, rows, parsed } = exportInMemory("1", 6, 300);
    const fp = sim.world.data.floorplan;
    const samples = (6 * 3600) / 300;
    expect(rows.doors).toBe(samples * fp.doors.length);
    expect(rows.windows).toBe(samples * fp.windows.length);
    expect(rows.equipment).toBe(samples * fp.equipment.length);
    expect(rows.weather).toBe(6);
    expect(new Set(parsed("people").map((r) => r[0])).size).toBe(samples);
    for (const r of parsed("weather")) expect(Number(r[0]) % 3600).toBe(0);
  }, 60000);

  it("uses only ids from rooms.json, activities.csv and the people on the map, and catches door passes when sampled every tick", () => {
    const { sim, parsed } = exportInMemory("1", 4, TICK_SECONDS);
    const rooms = roomsJson(sim.world);
    const roomIds = new Set(rooms.rooms.map((r) => r.id));
    const entries = new Set(activityRows(sim.world.data.activities).map((r) => `${r[1]} ${r[2]} ${r[3]}`));
    const people = parsed("people");
    const onMap = new Set(people.map((r) => r[2]));
    for (const r of people) {
      expect(roomIds).toContain(r[4]);
      expect(entries).toContain(`${r[7]} ${r[10]} ${r[11]}`);
    }
    expect(new Set(parsed("doors").map((r) => r[2]))).toEqual(new Set(rooms.doors.map((d) => d.id)));
    expect(new Set(parsed("equipment").map((r) => r[2]))).toEqual(new Set(rooms.equipment.map((e) => e.id)));
    for (const r of parsed("windows")) expect(rooms.windows.map((w) => w.id)).toContain(r[2]);
    const objects = new Set(rooms.objects.map((o) => o.id));
    for (const r of parsed("touches")) {
      expect(objects).toContain(r[3]);
      expect(onMap).toContain(r[2]);
    }
    // Every tick sampled: someone holding a closed door shows in doors.csv, as a handle touch does in touches.csv.
    expect(parsed("doors").some((r) => r[4] !== "")).toBe(true);
    expect(parsed("touches").some((r) => r[3]!.endsWith(".handle"))).toBe(true);
  }, 60000);

  it("is deterministic, and takes only whole ticks as the sampling interval", () => {
    expect(exportInMemory("5", 2, 60).lines).toEqual(exportInMemory("5", 2, 60).lines);
    const sim = createSim({ seed: "1", data });
    expect(() => exportRun(sim, { endT: sim.t + 60, everySeconds: 7 }, () => {})).toThrow(/5 s ticks/);
  }, 60000);

  it("quotes only cells that need it, and writes the sim's clock", () => {
    expect(csvLine(["a", 1, true, null, undefined, 'say "hi", then go'])).toBe('a,1,true,,,"say ""hi"", then go"');
    expect(isoTime(108000)).toBe("2026-11-03T06:00:00");
    expect(isoTime(108000 + 86400 * 59 + 3725)).toBe("2027-01-01T07:02:05");
  });
});
