# Progress: the activity export

## Done

- **Spec and plan** approved 2026-10-08 (`spec.md`, `plan.md`), with the project owner's changes: keep the infection columns, gzip by default (`--no-gzip`), door passes shorter than the interval noted as handle touches, and `--every` for the sampling interval.
- **The export** (branch `activity-export`, not yet a PR):
  - Engine: `src/export.ts` (rows, `rooms.json`, `activities.csv`, the manifest; `exportRun` reads the world and hands lines to the caller). No change to any run.
  - CLI: `scripts/export.ts`, `pnpm --filter @vch/sim-engine export`: `--seed`/`--seeds`, `--start`, `--days`/`--hours`, `--every`, `--director`, `--scenario`, `--deaths`, `--out`, `--no-gzip`.
  - Tests: `test/export.test.ts` (8): the committed 2-hour sample written again byte for byte, gzip equals plain, headers match the manifest, rows equal `describe()` at every sample, every touch and event present, a row for everything at each sample, ids known, door passes caught at `--every 5s`, determinism, quoting and the clock.
  - Docs: docs/07 (the export section), README (the data, quick start, roadmap), CLAUDE.md, roadmap.
  - **A test flake fixed:** `celebrations.test.ts`'s party-versus-ordinary-Wednesday test timed out at Vitest's 5 s default in 2 of 10 full runs (about 5.1 s under load); its timeout is now 60 s (docs/12). Then 5 full runs in a row passed.
  - **Checks:** typecheck and all 340 tests pass, golden fingerprints included. Measured: 9.6 MB a seed a day plain, 17.4 MB a month gzipped, about 10 s a month. The first dataset (seeds 1 to 4, December and July, director random) is 139 MB gzipped, made in about 80 s. Seed 3's December has a flu case, with the infection columns filled in. July has 9,320 window-open minutes for seed 1, against 318 in December. Python's gzip and csv modules read the files.

## In progress

- Waiting for the project owner's review before the PR is opened.

## Next

- Open the PR (no attribution).
- After merge: generate the first reference dataset for the air-model repo and tag `v1.0-testbed`.

## Blockers

- None.

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-10-08 | Spec, plan and build | Picked up the export left unstarted on 2026-10-01; spec approved with four changes; built, tested and measured on branch `activity-export`, stopped for review before the PR |
