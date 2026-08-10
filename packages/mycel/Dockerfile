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
# The final image is one bundled JavaScript file plus curl. It carries no
# node_modules, no pnpm, no corepack and no source tree.
#
# The previous shape copied the whole monorepo — every workspace package's
# dependencies, including Ink, React, discord.js and a natively-compiled sqlite
# — into the runtime image, to run a service whose own dependencies are three
# pure-JS packages. On an e2-small that measured: 87s to copy /app, 182s to
# chown it, 200s to export the layers. Ten minutes of a deploy spent moving code
# the Exchange never loads.
#
# The build stage below still installs the full workspace, and that is fine:
# it is one cached layer that only re-runs when the lockfile changes. What was
# expensive was carrying the result into the final image, and now nothing does.
#
# Deliberately NOT built on packages/habitat/Dockerfile. That image carries the
# Docker CLI, mise, git and ripgrep because a habitat clones repos and runs
# toolchains. Every one of those would be attack surface on the one service that
# holds the money ledger.

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

# tsup inlines every import, including the three runtime dependencies — all pure
# JavaScript — so what comes out needs no install and no node_modules.
RUN pnpm --filter @umwelten/mycel build

FROM node:22-slim
ENV NODE_ENV=production

# curl for the healthcheck below and for reading Secret Manager through the
# instance metadata server (ADR 0030). ca-certificates is NOT implied: on Debian
# it arrives through curl's Recommends, which --no-install-recommends drops, and
# without it the metadata call still works (plain HTTP) while every HTTPS call
# fails with curl exit 77, CURLE_SSL_CACERT_BADFILE.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Not root. Mycel writes nothing to disk, so there is no reason for it to be
# able to. Created before the copy so ownership is set during it.
RUN useradd --system --uid 10001 mycel

WORKDIR /app
COPY --from=build --chown=mycel:mycel /app/packages/mycel/dist/mycel.js ./mycel.js
COPY deploy/mycel/entrypoint.sh /usr/local/bin/mycel-entrypoint
RUN chmod 0755 /usr/local/bin/mycel-entrypoint

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
CMD ["node", "/app/mycel.js", "serve"]
