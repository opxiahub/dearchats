# syntax=docker/dockerfile:1.7

# ─── 1. deps ──────────────────────────────────────────────────────────────
# Install full deps (including devDeps) on a Debian base so better-sqlite3
# can either use its prebuilt linux-x64-glibc binary or compile from source
# if it has to (python3/make/g++ are present).
FROM node:22-bookworm-slim AS deps
ENV PYTHONUNBUFFERED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` is reproducible; --include=dev so Next + TS build later.
RUN npm ci --include=dev

# ─── 2. builder ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Produces .next/standalone (minimal server) + .next/static.
# Ensure public/ exists so the runner COPY never fails — Next doesn't require
# the folder, but our Dockerfile does (audio stems & favicons live here).
RUN mkdir -p public && npm run build

# ─── 3. runner ────────────────────────────────────────────────────────────
# Same Debian glibc family as the builder, so any better-sqlite3 binary
# (prebuilt or compiled in deps stage) stays ABI-compatible.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Override at deploy time if you'd rather mount /data instead of /app/.data.
ENV DEARCHATS_DATA_DIR=/app/.data

RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Standalone server + just-enough node_modules (better-sqlite3 included via
# serverExternalPackages — it's copied into .next/standalone/node_modules).
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Persistent data lives here. The named volume in compose / the Coolify
# persistent storage mount should target this exact path.
RUN mkdir -p /app/.data && chown -R node:node /app/.data
VOLUME ["/app/.data"]

USER node
EXPOSE 3000

# dumb-init forwards SIGTERM cleanly so SQLite/WAL gets a chance to checkpoint.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
