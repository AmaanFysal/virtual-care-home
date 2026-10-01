# 13 · Hosting

**Purpose:** how the public demo runs, and how to deploy and update it.
- The web app (`apps/web`) is a static site on **Vercel**.
- The sim server (`apps/server`) runs on **Fly.io**, always on, with a small disk.

Decisions are in ADR-0008.

```
browser ──https──▶ Vercel (static web app)
   │
   └──wss──▶ Fly.io machine (sim server, 10x) ──▶ volume /data: event log + snapshots
```

Vercel can't host the server: it has to run continuously and keep WebSockets open.

## Production mode

**Production mode is switched on only by the host's settings** (`VCH_MODE=production` in `fly.toml`). Anyone running the repo with `pnpm dev` gets every control, exactly as before: all speeds, pause, step, the Director tab and event injection.

On the public server:
- **The world runs continuously at 10x.** A sim day takes 2.4 real hours.
- **Viewers are read-only.** They can watch, and inspect people and rooms. The clock, the Director tab and event injection are hidden, and the server refuses those commands from viewers.
- **Admins** open the hidden page `/#/admin` and enter the admin token. The server checks it; the browser keeps it for that tab only, and it's never in the site's code. Five wrong tokens from one address lock it out for 15 minutes.
- **Demo settings:**
  - `DIRECTOR=random`;
  - `DEATHS=off`, which turns off both deaths and end-of-life decline.
- **Snapshots:**
  - every 5 minutes, and when the server is stopped (a deploy sends SIGTERM);
  - a restart resumes the latest one;
  - a deploy that changes the engine, the data or the director settings starts a fresh run instead, at 06:00 on the day after the last snapshot's date, so the clock carries on.
- **Bounded storage:**
  - events older than 30 sim days are pruned (about 0.5 MB a sim day, so about 15 MB a run);
  - inputs and admin commands are kept;
  - only the two newest runs are kept;
  - a snapshot is about 45 KB.
- **Limits:**

  | Limit | Value |
  |---|---|
  | Origins | `ALLOWED_ORIGINS` only |
  | Connections per address | 5 at once, 20 new a minute |
  | Viewers in total | 200 |
  | Messages per connection | 5 a second |
  | Largest message | 4 KB |

  A viewer too slow to keep up gets a fresh picture once it catches up, or is disconnected after 30 seconds.
- **HTTPS/WSS only:** Fly terminates TLS and redirects http. A production web build refuses a server address that isn't `wss://`.

| Server setting (`fly.toml` `[env]`, or a secret) | Value |
|---|---|
| `VCH_MODE` | `production` |
| `ADMIN_TOKEN` (**secret**) | at least 24 characters; `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` (secret, to keep `fly.toml` generic) | the Vercel production URL, plus any custom domain, comma-separated |
| `DIRECTOR`, `DEATHS`, `SPEED`, `SEED` | `random`, `off`, `10`, `1` |
| `RUNS_DIR` | `/data/runs` (the volume) |
| `SNAPSHOT_EVERY_MIN`, `EVENT_RETENTION_DAYS`, `KEEP_RUNS`, `MAX_VIEWERS` | `5`, `30`, `2`, `200` |
| `CLIENT_IP_HEADER` | `fly-client-ip`: the visitor's address, for the per-address limits |

## Cost (prices checked 2026-10-01)

| | Monthly |
|---|---|
| Fly.io `shared-cpu-1x`, 512 MB, always on | about $5.83 |
| Fly volume, 1 GB | $0.15 |
| Fly data transfer | $0.02/GB. One viewer watching for an hour is about 4 MB uncompressed and roughly 0.2 MB compressed, so pennies |
| Vercel Hobby (static site) | free |
| **Total** | **about $6** |

## First deployment

You need a Fly.io account (with a card), a Vercel account, and the repo on GitHub.

### 1. Create the Fly app

```sh
brew install flyctl            # or: curl -L https://fly.io/install.sh | sh
fly auth login
fly apps create vch-sim        # pick your own name; then set `app = "..."` in fly.toml to match
fly volumes create vch_data --region lhr --size 1 --app vch-sim
```

The server's address will be `https://vch-sim.fly.dev`; the browser connects to `wss://vch-sim.fly.dev/ws`.

### 2. Create the Vercel project

1. In Vercel: **Add New → Project**, then import the GitHub repo.
2. **Root Directory:** `apps/web`. Leave "Include files outside the root directory in the Build Step" on: the app uses `packages/shared-types`.
3. **Framework, install, build and output** come from `apps/web/vercel.json`:

   | Setting | Value |
   |---|---|
   | Framework | Vite |
   | Install | `pnpm install --frozen-lockfile` |
   | Build | `pnpm build` |
   | Output | `dist` |

4. **Node.js version** (Settings → General): 22.x.
5. **Environment variable** for **Production**: `VITE_SIM_URL = wss://vch-sim.fly.dev/ws`. It goes into the site at build time and holds no secret.
6. **Deploy.** Note the production URL, e.g. `https://vch-sim.vercel.app`.

### 3. Set the server's secrets and deploy it

```sh
TOKEN=$(openssl rand -hex 32); echo "$TOKEN"   # keep it in your password manager
fly secrets set --app vch-sim ADMIN_TOKEN="$TOKEN" ALLOWED_ORIGINS="https://vch-sim.vercel.app"
fly deploy --ha=false          # one machine: the world is one process with one disk
```

Check it:

```sh
curl https://vch-sim.fly.dev/api/health    # {"ok":true,"runId":"run-…","tick":…,"viewers":0}
fly logs --app vch-sim                      # "Virtual care home (production) on 0.0.0.0:8080: run …, 10x, director random, deaths off"
```

Then open the Vercel URL: the wing should be running. Open `/#/admin` and enter the token to get the controls.

### ALLOWED_ORIGINS

- **List exact origins:** the Vercel production URL and any custom domain, comma-separated, e.g. `https://vch-sim.vercel.app,https://care.example.org`. A browser on any other origin is refused before its WebSocket opens.
- **No wildcards or paths;** the server refuses to start with one.
- **Vercel preview deployments stay blocked.** Their URLs (`vch-sim-git-<branch>-<you>.vercel.app` and the per-deploy ones) aren't listed, so previews build but can't connect.
- **Adding a custom domain:** add it in Vercel (Settings → Domains), then `fly secrets set --app vch-sim ALLOWED_ORIGINS="https://vch-sim.vercel.app,https://care.example.org"`. Setting a secret restarts the server, which resumes from its snapshot.

## Updating

| What changed | Do | What happens to the world |
|---|---|---|
| The web app | Merge to `main`; Vercel deploys it | Nothing: viewers reconnect |
| The server only (`apps/server`) | `fly deploy` from the repo root | Resumes from the snapshot saved on shutdown |
| The engine (`packages/sim-engine`, `packages/shared-types`) or `data/` | `fly deploy` | A fresh run, at 06:00 on the day after the last snapshot's date (the log says why) |
| `DIRECTOR`, `DEATHS` or `SEED` | Edit `fly.toml`, `fly deploy` | A fresh run, as above |
| The admin token | `fly secrets set --app vch-sim ADMIN_TOKEN="$(openssl rand -hex 32)"` | Restarts and resumes. Admins sign in again with the new token |

A deploy stops the machine and starts the new one, about 10 to 30 seconds without the stream. Browsers reconnect on their own.

## Running and checking it

- **Health:** `https://<app>.fly.dev/api/health` gives the run id, tick and number of viewers. Fly checks it every 30 seconds.
- **Logs:** `fly logs` shows resumes, fresh runs and their reasons, pruning, and snapshot errors.
- **Shell:** `fly ssh console`, then `ls /data/runs/*/`. Each run folder holds `events.sqlite` and its newest three `snap-<tick>.v8.gz`.
- **Backups:** Fly snapshots the volume daily and keeps them 5 days (`fly volumes list`, then `fly volumes snapshots list <volume id>`).
  - To roll back: create a volume from a snapshot with `fly volumes create vch_data --snapshot-id <id> --region lhr`, then replace the machine's volume (Fly's docs: "Restore a volume from a snapshot").
  - The server resumes whatever run it finds on the volume.

## Trying production mode locally

```sh
VCH_MODE=production ADMIN_TOKEN=$(openssl rand -hex 24) ALLOWED_ORIGINS=http://localhost:5173 \
  HOST=127.0.0.1 RUNS_DIR=/tmp/vch-runs DIRECTOR=random DEATHS=off pnpm dev
```

The page at http://localhost:5173 is then a viewer; `http://localhost:5173/#/admin` asks for the token. Plain http origins are allowed for localhost only. To try the container instead:

```sh
docker build -t vch-sim . && docker run -p 8080:8080 -v vch_data:/data \
  -e VCH_MODE=production -e ADMIN_TOKEN=… -e ALLOWED_ORIGINS=http://localhost:5173 -e DIRECTOR=random -e DEATHS=off vch-sim
```

Then start the web app with `VITE_SIM_URL=ws://localhost:8080/ws pnpm --filter @vch/web dev`.
