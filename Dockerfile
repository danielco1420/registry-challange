# syntax=docker/dockerfile:1

# Multi-stage build: install deps once, build with devDependencies available,
# then ship a minimal runtime image with production deps only, no build
# tooling, no .env, and no source outside the compiled server/client output.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
# Keep in sync with `packageManager` in package.json. Declared inside the stage:
# an ARG declared before the first FROM is not visible to RUN instructions.
ARG PNPM_VERSION=12.16.1
WORKDIR /app
# Node 22's bundled Corepack is too old for pnpm 12 (see CLAUDE.md), so install
# pnpm directly from npm.
RUN npm install -g pnpm@${PNPM_VERSION}

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
# --ignore-scripts: the root `prepare` script runs husky, a devDependency that
# isn't installed here, and no production dependency needs an install script.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime: minimal final image, non-root, healthchecked ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Files stay owned by root, so the non-root `node` user (uid/gid 1000, built
# into the official image) can read the app but not modify it.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Needed at runtime: `"type": "module"` makes Node load build/server/index.js as ESM.
COPY package.json ./

USER node

# @react-router/serve listens on $PORT, defaulting to 3000.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)throw new Error(r.status)}).catch(()=>process.exit(1))"

# Same server as `pnpm start` (package.json), minus `--env-file-if-exists=.env`:
# the image has no .env; configuration comes from `docker run -e/--env-file` or
# Compose. Keep this in sync if the `start` script changes.
CMD ["node", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
