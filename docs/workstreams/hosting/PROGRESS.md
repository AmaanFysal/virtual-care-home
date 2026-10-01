# Progress: hosting

## Done (2026-10-01, branch `hosting`)

All of plan.md. Checks:
- **Tests:** `pnpm typecheck` and `pnpm test` pass.
- **Snapshot determinism:** restored at six ticks through v8's serialiser, the rest of the run is byte-identical. A deliberately broken restore (random streams reseeded) fails 7 of the 9 snapshot tests.
- **Production mode on this machine** (19 checks over real WebSockets):
  - viewers get role viewer and the world running at 10x;
  - a viewer's pause, speed and inject are refused, and inspect works;
  - the right token gives admin, and admins can pause while viewers see it;
  - other origins and a preview URL are refused (403);
  - a burst of 20 messages gets 5 answers;
  - a message over 4 KB closes the socket;
  - a 6th connection from one address is refused;
  - after 5 wrong tokens even the right one is locked out.
- **Restarts:**
  - SIGTERM, then a restart, resumes at the same tick;
  - `kill -9`, then a restart, resumes from the last periodic snapshot with a gap-free log;
  - a changed data file starts a fresh run at Wed 06:00, the morning after the snapshot.
- **Dev parity:** with no settings the server starts paused at 60x, any origin connects as admin, every command works, and nothing is snapshotted.
- **Browser** (headless Chrome):
  - a viewer sees the clock, weather and "10x", with no buttons or Director tab;
  - `#/admin` with the token shows every control, kept after a reload, with sign out back to viewer;
  - a wrong token is reported;
  - the event log still fills the side panel.
- **Docker:**
  - the image builds and runs as the `node` user with node as PID 1, on a root-owned volume;
  - the 19 checks pass against it;
  - `docker stop`/`start` saves and resumes;
  - the web app connects to it.
- **Bundle:** a production build has the server URL and no token, `ADMIN_TOKEN` or `VCH_MODE`. A build for Vercel's production without `VITE_SIM_URL`, or with `ws://`, fails.
- **Measured:**
  - about 3,200 events and 0.5 MB of log per sim day (about 15 MB for 30 days);
  - a snapshot is 45 KB;
  - a viewer receives about 4 MB an hour uncompressed, roughly 0.2 MB compressed.

## Public-repo audit (2026-10-01)

- **Secrets:**
  - gitleaks 8.30.1 over the full history (all refs; 57 non-merge commits, 5.7 MB): no leaks;
  - gitleaks over this branch's files: no leaks;
  - no `.env`, key, certificate or credentials file has ever been committed.
- **Personal data:**
  - commit authors and committers use GitHub's no-reply address only;
  - no email address of a person anywhere in the history (the one address added, `noreply@anthropic.com`, is a pattern in `.githooks/attribution-patterns.txt`, the hook that blocks attribution);
  - no phone numbers, UK postcodes, NHS-number-shaped numbers or street addresses in any version of `data/`; the people are fictional cards.
- **Local path:** `tools/characters/CREATING_CHARACTERS.md` gave a local path with the owner's macOS username on two lines. It's replaced in this branch. It remains in the history (commit d505b99). Rewriting history is the owner's call; it isn't done.
- **Large files:** the largest blobs ever committed are a tile sheet, the weather file and two reports, each under 600 KB.

## Next

The owner deploys (docs/13). Then `README.md`'s demo link is filled in.
