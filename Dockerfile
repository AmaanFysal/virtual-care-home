# The sim server (apps/server) for the public demo, on Fly.io (docs/13). The web app is deployed
# separately, on Vercel. Production settings come from fly.toml and Fly secrets, not from here.
FROM node:22-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/sim-engine/package.json packages/sim-engine/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter "@vch/server..."

# The engine and the shared types (their source also names the engine build: persist.ts), the
# server, and the data files.
COPY packages/shared-types/src packages/shared-types/src
COPY packages/sim-engine/src packages/sim-engine/src
COPY packages/sim-engine/tools packages/sim-engine/tools
COPY apps/server/src apps/server/src
COPY data data

ENV NODE_ENV=production RUNS_DIR=/data/runs PORT=8080
EXPOSE 8080
WORKDIR /app/apps/server
# Fly mounts the volume as root: hand /data to the node user, then run as node. exec keeps node
# as the main process, so it gets the SIGTERM a deploy sends and saves a final snapshot.
CMD ["sh", "-c", "mkdir -p /data && chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node --import tsx src/index.ts"]
