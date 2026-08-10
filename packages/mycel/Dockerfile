# syntax=docker/dockerfile:1.4
#
# Mycel — the Exchange.
#
# Build (from monorepo root):
#   docker build -t mycel -f packages/mycel/Dockerfile .
#
# Run:
#   docker run -p 7438:7438 -e MYCEL_DATABASE_URL=postgres://… mycel
#
# Deliberately NOT built on packages/habitat/Dockerfile. That image carries the
# Docker CLI, mise, git and ripgrep because a habitat clones repos and runs
# toolchains. Mycel is an HTTP service over Postgres: it clones nothing, spawns
# nothing, and needs no volume — its state is in Neon. Every one of those tools
# would be attack surface on the one service that holds the money ledger.

FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

WORKDIR /app

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json                packages/core/
COPY packages/protocols/package.json           packages/protocols/
COPY packages/sessions/package.json            packages/sessions/
COPY packages/evaluation/package.json          packages/evaluation/
COPY packages/habitat/package.json             packages/habitat/
COPY packages/ui/package.json                  packages/ui/
COPY packages/mycel/package.json               packages/mycel/
COPY packages/supplier/package.json            packages/supplier/
COPY packages/cli/package.json                 packages/cli/
COPY packages/umwelten/package.json            packages/umwelten/

RUN pnpm install --frozen-lockfile

COPY . .

FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

# curl for the healthcheck below and for reading Secret Manager through the
# instance metadata server (ADR 0030). Nothing else is needed at runtime — in
# particular no gcloud SDK and no fnox: the attached service account is the
# credential, so there is nothing to install to authenticate with.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app /app
COPY deploy/mycel/entrypoint.sh /usr/local/bin/mycel-entrypoint
RUN chmod 0755 /usr/local/bin/mycel-entrypoint

# Not root. Mycel writes nothing to disk, so there is no reason for it to be
# able to.
RUN useradd --system --uid 10001 mycel && chown -R mycel:mycel /app
USER mycel

ENV MYCEL_PORT=7438
EXPOSE 7438

# Reports whether the store is reachable, not merely whether the process is up:
# a service that answers while its database is gone is worse than one that does
# not answer, because Dispatch keeps sending it traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7438/health || exit 1

# Secrets are resolved into this process's environment and nowhere else. With
# MYCEL_SECRETS unset the entrypoint is a passthrough, so `docker run -e ...`
# still works off a GCE instance.
ENTRYPOINT ["/usr/local/bin/mycel-entrypoint"]
CMD ["pnpm", "exec", "tsx", "packages/cli/src/entry.ts", "mycel", "serve"]
