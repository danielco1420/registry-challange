# syntax=docker/dockerfile:1

# Multi-stage build: install deps once, build with devDependencies available,
# then ship a minimal runtime image with production deps only, no build
# tooling, no .env, and no source outside the compiled server/client output.

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=12.16.1

FROM node:${NODE_VERSION} AS base
WORKDIR /app
# Corepack ships with Node but needs enabling + pinning to the project's pnpm.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# ---- deps: full dependency graph (incl. devDependencies) for the build ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: compile the React Router app (client + SSR server bundle) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- prod-deps: production-only dependency graph for the runtime image ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: minimal final image, non-root, healthchecked ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Alpine's "node" image already ships a non-root `node` user/group (uid/gid 1000).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./

USER node

# @react-router/serve listens on $PORT, defaulting to 3000.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)throw new Error(r.status)}).catch(()=>process.exit(1))"

CMD ["node", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
