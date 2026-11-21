# syntax=docker/dockerfile:1.4
#
# Gaia HabitatHost Container — single-process `pi-durable` multi-Habitat host.
#
# Multiplexes transactional SQLite-backed `DurableHabitat` agents (Node 24 built-in
# `node:sqlite`), A2A 1.0 JSON-RPC + Agent Cards, and `/api/habitats` on one port
# with zero Docker-in-Docker privileges.
#
# Build (from monorepo root):
#   docker build -t habitat -f packages/habitat/Dockerfile .
#
# Run:
#   docker run -p 7420:7420 -v gaia-data:/data -e GAIA_API_KEY=... habitat

FROM node:24-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Ensure a real TLS CA bundle on Debian slim + git & ripgrep for repo/session tools.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --reinstall ca-certificates openssl \
    && apt-get install -y --no-install-recommends curl git ripgrep \
    && update-ca-certificates --fresh \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /habitat

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/cli/package.json ./packages/cli/
COPY packages/evaluation/package.json ./packages/evaluation/
COPY packages/habitat/package.json ./packages/habitat/
COPY packages/mycel/package.json ./packages/mycel/
COPY packages/pi/package.json ./packages/pi/
COPY packages/protocols/package.json ./packages/protocols/
COPY packages/sessions/package.json ./packages/sessions/
COPY packages/substrate/package.json ./packages/substrate/
COPY packages/supplier/package.json ./packages/supplier/
COPY packages/umwelten/package.json ./packages/umwelten/

RUN printf '%s\n' 'package-import-method=copy' > .npmrc
RUN --mount=type=cache,id=pnpm-habitat,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY packages ./packages/
RUN pnpm -r build

COPY packages/habitat/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh && mkdir -p /data

VOLUME /data

ENV NODE_ENV=production
ENV HABITAT_WORK_DIR=/data
ENV GAIA_PORT=7420
ENV PORT=7420

EXPOSE 7420

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.GAIA_PORT||process.env.PORT||7420)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "packages/umwelten/dist/cli/entry.js", "habitat", "gaia", "--host", "0.0.0.0"]
