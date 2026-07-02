# Somali Music Archive — API image (ARCHITECTURE.md §13).
# Multi-stage: install + bundle in a builder, ship a slim runtime that runs as a
# NON-ROOT user (§11 — "Docker containers run as non-root user"). The API is
# bundled by tsup so the runtime image needs no dev toolchain and no source.

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# The API is part of an npm-workspaces monorepo; copy the workspace manifests and
# the packages it depends on so the bundle can inline the @sma/* sources.
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN npm ci
RUN npm run build --workspace @sma/api

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only production dependencies for the API workspace.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages ./packages
RUN npm ci --omit=dev --workspace @sma/api && npm cache clean --force

# The self-contained bundle produced by tsup.
COPY --from=builder /repo/apps/api/dist ./apps/api/dist

# Drop privileges — the built-in `node` user (uid 1000) owns nothing it can abuse.
USER node

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
