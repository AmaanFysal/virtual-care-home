# Workstream spec: hosting

**Goal:** the wing runs in public. The web app is on Vercel and the sim server on an always-on host with a disk. Viewers watch read-only; the project owner controls it with a secret token. Running the repo locally stays exactly as it was.

Status: **approved 2026-10-01** (project owner). How to deploy: docs/13. Decisions: ADR-0008.

## Decisions (project owner, 2026-10-01)

1. **Host:** Fly.io, about $6 a month: one always-on 512 MB machine with a 1 GB volume in London. Compared with Railway, Render and AWS Lightsail in docs/13.
2. **Deploys:** a deploy with new engine code or data starts a fresh run at 06:00 on the day after the last snapshot's date. A restart with the same code and data resumes the latest snapshot.
3. **Production mode only from the host's environment** (`VCH_MODE=production`). `pnpm dev` keeps every control: all speeds, pause, step, the Director tab and event injection.
4. **ALLOWED_ORIGINS:** the production Vercel URL plus any custom domain. Vercel preview deployments stay blocked.
5. **The README rewrite and the MIT licence** are in PR #19. This workstream only adds a short Hosting section.
6. **The owner deploys** following docs/13.

## In scope

- **Server production mode:**
  - the world runs continuously at a fixed 10x;
  - viewers are read-only (watch, inspect people and rooms);
  - admin controls (speed, pause, director triggers, inject events) only with `ADMIN_TOKEN`, through a hidden admin page; the token never appears in the browser bundle.
- **Persistence:** periodic snapshots to the persistent disk, resume from the latest after a restart, and bounded storage for the event log.
- **Demo settings:** deaths and end-of-life off, director on.
- **Network:** HTTPS/WSS only, origin checks and rate limits on connections.
- **Web app:** the server address from `VITE_SIM_URL`; controls only for admins.
- **Deployment:** a Dockerfile and `fly.toml` for the server, `vercel.json` for the web app, and a step-by-step guide (docs/13).
- **Public-repo audit:** secrets and personal data in the repo and its full history, reported before any history rewrite.

## Out of scope

The activity export (after the owner's go-ahead), branching from snapshots (Phase 4), several server instances, and user accounts beyond the one admin token.
