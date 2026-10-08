# Plan: the activity export

> Approved by the project owner on 2026-10-08 with the spec. One PR, on branch `activity-export`, stopping for review before it's opened.

## Approach

- **Pure row building in the engine package, file writing in a script.** `src/export.ts` turns a world description (and the world's infection state) into CSV rows, and builds `rooms.json`, `activities.csv` and the manifest. It does no I/O, as the engine rules require. `scripts/export.ts` runs the sim and writes the files.
- **The run loop:** step tick by tick, as `sim` does.
  - Every tick: keep the tick's events and touches.
  - Every sampling interval (`--every`, default 60 sim seconds): call `sim.describe()` and write a row for each person, door, window and item of equipment.
  - Every hour: write a weather row.
- **Chunks, not arrays.** A month is millions of rows, so each stream's lines are flushed to its file in 4 MB chunks, gzipped one chunk at a time (concatenated gzip members make one valid `.gz` file). `exportRun` stays synchronous and memory stays flat.
- **The proof that nothing changed:** no `src/` change touches a run. The golden fingerprint tests run as they are.

## Tasks

| # | What | Status |
|---|---|---|
| 1 | `src/export.ts`: CSV quoting, the header for each stream, row builders, `rooms.json`, `activities.csv`, the manifest | Done |
| 2 | `scripts/export.ts` and the `export` package script: `--seed`/`--seeds`, `--start`, `--days` (or `--hours`), `--director`, `--scenario`, `--deaths`, `--out`, `--gzip` | Done, with `--every` and gzip by default (`--no-gzip`), spec decisions 6 and 8 |
| 3 | `test/export.test.ts`: determinism (written twice, byte-identical), rows equal `describe()` at sampled minutes, one row per minute per person, door, window and item, every touch and event present, ids valid, headers match the manifest | Done: 8 tests |
| 4 | A committed 2-hour sample (`test/fixtures/export-sample/`) and a test that regenerates it and compares | Done: `seed-1-2026-11-03-2h` (`--every 5m --no-gzip`, 260 KB) |
| 5 | Measure a real week (time and size, plain and gzip) and put the numbers in the spec | Done: the spec's Size section |
| 6 | Docs: docs/07 (the export section), CLAUDE.md (the command), README (data), roadmap (v1.0-testbed done), PROGRESS | Done |

After merge, with your go-ahead: generate the first reference dataset (seeds 1 to 4, December and July, director `random`) and tag `v1.0-testbed`.

## Risks

- **Size:** measured at 9.6 MB a seed a day plain and 17.4 MB a month gzipped (spec).
- **Run time:** measured at about 10 s a month per seed, with `describe()` every minute.
- **The committed sample changes with the engine's behaviour:** any change to what people do changes `events.csv` and the rest, so the sample is written again and its diff reviewed (the command is at the top of `test/export.test.ts`).
- **Doors held open for under a minute** fall between samples. Each pass still shows as a handle touch in `touches.csv` (spec).
