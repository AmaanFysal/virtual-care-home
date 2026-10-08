# Workstream spec: the activity export

**Goal:** write a run's activity data to files that external models (the air model first, in its own repo) can read. Every sim minute, the files record who is in which room doing what and how hard, the doors, windows and equipment, the touches and the weather, under a versioned schema. This completes v1.0-testbed with the plug-in API deferred (roadmap, project owner 2026-10-01: "the pipeline uses files").

Source: [roadmap](../../roadmap.md) (v1.0-testbed), [v1-testbed spec](../v1-testbed/spec.md) (the world description), [ADR-0006](../../adr/0006-equipment-and-weather-in-the-world-description.md). Constraints: [00-constitution](../../00-constitution.md).
Status: **approved 2026-10-08**, with the changes recorded as decisions 5 to 8.

## Decisions (project owner, 2026-10-08)

1. **CSV, one file per stream,** plus `rooms.json` (geometry) and `manifest.json` (what the run was).
2. **Sampled every sim minute.** Touches and events keep their exact time to the second.
3. **Full rows every minute** for people, doors, windows and equipment, so a reader never has to forward-fill.
4. **First reference dataset:** seeds 1 to 4, a winter month (December) and a summer month (July), director `random`. Generated on demand, not committed; a small sample is committed for the tests.
5. **Keep the infection columns** in `people.csv`.
6. **Gzip by default** (`.csv.gz`); `--no-gzip` writes plain CSV.
7. **Door passes shorter than the sampling interval** appear only as door-handle touches in `touches.csv`, so the air model can treat those as brief openings (below).
8. **`--every` sets the sampling interval** (`5s`, `1m`, `5m`, ...; default `1m`), recorded in `manifest.json`.

## What it is

A headless command in `packages/sim-engine`, beside `sim` and `describe`:

```
pnpm --filter @vch/sim-engine export --seed 1 --start 2026-12-01 --days 31 --director random [--every 1m] [--out runs/export] [--no-gzip]
pnpm --filter @vch/sim-engine export --seeds 1-4 --start 2027-07-01 --days 31 --director random
```

- It runs the sim from `--start` (06:00 on that date, so the weather is that season's) for `--days` (or `--hours`), and calls `sim.describe()` once each sampling interval.
- **It changes nothing in the engine.** `describe()` is pure, so the event log and the golden fingerprints stay the same.
- Each seed goes in its own folder, `<out>/seed-<n>-<start>-<days>d/`. `runs/` is already gitignored.
- `--director` takes `off`, `random`, `scenario` or `both`, with `--scenario <id>`, as `sim` does. `--deaths off` matches the public demo.
- `--every` is the sampling interval: a whole number of ticks (5 s), from `5s` up, e.g. `5s`, `30s`, `1m`, `5m`. Default `1m`.
- Files are gzipped (`.csv.gz`) by default; `--no-gzip` writes plain `.csv`. The sizes are below.

## The files

All times are sim times. `t` is integer seconds since the epoch (Mon 2 Nov 2026 00:00). `time` is the same moment as `2026-12-01T06:00:00`: the sim's clock, with no daylight saving. Rows are sorted by `t`, then by id. Booleans are `true` and `false`; an empty cell means no value.

### `manifest.json`

```json
{
  "exportSchema": 1,
  "worldSchema": 1,
  "seed": "1",
  "start": "2026-12-01", "startT": 2527200, "endT": 5205600, "days": 31,
  "sampleSeconds": 60,
  "gzip": true,
  "director": { "mode": "random", "scenario": null, "deaths": true },
  "dataVersion": "…",
  "weather": { "place": "London", "source": "Open-Meteo (ERA5), CC BY 4.0", "period": "2025-10-01 to 2026-09-30" },
  "files": { "people.csv.gz": { "rows": 812345, "columns": ["t", "time", "…"] } },
  "command": "export --seed 1 --start 2026-12-01 --days 31 --director random --every 1m"
}
```

The manifest has no wall-clock time, so the same command always writes byte-identical files.

### `rooms.json`: the geometry (written once)

- **Rooms:** id, name, kind, rect (m), floor area (m²), ceiling height (m), and `inside`, the room an en-suite sits in.
- **Doors:** id, the two rooms, the opening's end points and width (m).
- **Windows:** id, room, wall, end points, width (m), and the restrictor's maximum opening (mm, from `data/building.json`).
- **Equipment:** id, kind, room, position.
- **Objects:** everything people touch (the ids in `touches.csv`): its room, and where it is (a point, a rect, carried, or with a person).

These are taken from `data/floorplan.json` and `data/building.json`, so a model reads the same ids as the CSVs.

### `people.csv`: one row a sample for each person on the map

| Column | From |
|---|---|
| `t`, `time` | the minute |
| `personId`, `kind` | `resident`, `staff`, `agency`, `visitor`, `external` |
| `roomId`, `x`, `y` | room and position (m) |
| `activity`, `met`, `intensity`, `book`, `code` | the world description: the 2024 Compendium entry (`older` or `adult` book, and its code) |
| `infection`, `infectionStatus`, `infectious`, `isolated` | the person's infection state (docs/10): the disease, its stage (`incubating`, `symptomatic`, `recovering`), and two booleans. Empty and `false` when they have none |

- **The infection columns are new and specific to the export** (decision 5). The engine keeps infection state on each person "so the future air model can read who is infectious and where" (state.ts). They're read from the world with the engine's own `infectionStatus()` (the stages the inspector shows), not from the world description, so `WORLD_SCHEMA` stays at 1.
- `infectious` is true while the person can pass it on: from before their symptoms to after them, by disease (data/director.json). Visitors and main-building staff don't catch infections in the engine (docs/10).
- An activity can have several Compendium entries (by walking aid, speed, or in bed), so each row carries the entry it used.

### `activities.csv`: the MET lookup (written once)

Every Compendium entry in `data/activities.json`. Columns: `group` (`resident` or `other`), `activity`, `book`, `code`, `met`, `intensity`, `description`, and what narrows it (`aid`, `belowMps`, `inBed`).

### `doors.csv`, `windows.csv`, `equipment.csv`: one row a sample for each

| File | Columns |
|---|---|
| `doors.csv` | `t`, `time`, `doorId`, `state` (`open`, `ajar`, `closed`, `locked`), `heldBy` |
| `windows.csv` | `t`, `time`, `windowId`, `roomId`, `state`, `openingMm` |
| `equipment.csv` | `t`, `time`, `equipmentId`, `kind`, `roomId`, `on`, `level`, `setpointC` |

- **Door passes shorter than the sampling interval appear only as door-handle touches** in `touches.csv` (decision 7). A closed door is held open (`heldBy`) only on the ticks someone is in its doorway, about 90 passes a day, so most fall between samples. Each pass through a door that isn't open (closed, ajar or locked) touches its handle (`<doorId>.handle`, or the exit's `.keypad`), so the air model can treat those touches as brief openings. `--every 5s` samples every tick and catches every pass in `doors.csv` too.
- **Instant uses** (a WC flush, `equipment.used`) take no time either. They're in `events.csv`.

### `touches.csv`: every touch, to the second

Columns: `t`, `time`, `personId`, `objectId`, `roomId` (where the person was). Collected every tick, whatever the sampling interval, so none are missed. About 650 a day.

### `weather.csv`: one row an hour

Columns: `t`, `time`, `dataTime` (the hour in the source data, GMT), `tempC`, `humidityPct`, `dewPointC`, `precipMm`, `cloudPct`, `windMps`, `windDirDeg`, `shortwaveWm2`, `pressureHpa`, `isDay`. The weather changes only on the hour, so a minute's row would repeat it 60 times.

### `events.csv`: the event log

Columns: `t`, `time`, `seq`, `type`, `source`, `actors` (`;`-separated), `payload` (JSON). The whole log, the same as the server stores it, every event to the second. It has what the minute samples don't: falls, illness and outbreaks, arrivals and departures, door and window changes with their reasons, and instant equipment uses.

## Size (measured 2026-10-08)

Seed 1, December, director `random`, sampled every minute. A month of every seed came out within 1% of these, December and July alike.

| File | Rows a day | A day, plain | A month, gzipped |
|---|---|---|---|
| `equipment` | 80,640 (56 items) | 5.4 MB | 9.6 MB |
| `doors` | 25,920 (18 doors) | 1.2 MB | 2.4 MB |
| `people` | about 13,700 (about 9.5 people on the map) | 1.5 MB | 2.0 MB |
| `windows` | 17,280 (12 windows) | 1.0 MB | 1.8 MB |
| `events` | about 3,200 | 0.47 MB | 1.4 MB |
| `touches` | about 650 | 0.04 MB | 0.16 MB |
| `weather`, `activities`, `rooms.json`, `manifest.json` | | under 0.1 MB | under 0.1 MB |
| **Total** | | **9.6 MB** | **17.4 MB** |

- **Gzip shrinks it about 17×:** a week is 67 MB plain and 4.0 MB gzipped.
- **A month is about 300 MB plain or 17.4 MB gzipped per seed.** The first dataset (4 seeds × December and July) is 139 MB gzipped.
- **Time:** about 10 s a month per seed; the whole first dataset takes about 80 s.

## Acceptance

- `pnpm typecheck` and `pnpm test` pass.
- **The engine is unchanged:** no `src/` change alters a run, and the golden fingerprints match.
- **Deterministic:** the same command writes byte-identical files twice.
- **Matches the world description:** for sampled times, each row in `people.csv`, `doors.csv`, `windows.csv` and `equipment.csv` equals `sim.describe()` at that minute.
- **Complete:**
  - one row a sample for each person on the map and for each door, window and item of equipment;
  - one weather row an hour;
  - every touch the run made;
  - every event in the log.
- **Valid:** each CSV's header matches `manifest.json`; every id in a CSV is in `rooms.json`, `activities.csv` or the people data.
- A 2-hour sample export (seed 1, director off, `--every 5m --no-gzip`, so it's small and readable) is committed under `packages/sim-engine/test/fixtures/export-sample/` and checked by a test, so any schema change shows up in review.
- **Docs:**
  - docs/07 gets a section on the export and its schema;
  - CLAUDE.md gets the command;
  - the README's data section;
  - the roadmap: v1.0-testbed done;
  - this workstream's PROGRESS.
- No attribution anywhere in git or GitHub (constitution rule 7).

## Out of scope

- **The plug-in API** (deferred) and anything that streams live from the server.
- **New world-description fields** (`WORLD_SCHEMA` stays at 1). The infection columns come from the world, outside the description.
- **The ventilation gaps from the UK-guidance review** (2026-10-01): isolated doors, extract fans, trickle vents and winter windows. They change the data, so they come after the export, with their own spec.
- **Any air, CO₂ or heat calculation.** That belongs to the external models' repos.
- **Parquet or a database.** CSV first; a converter can come later if a model needs it.
