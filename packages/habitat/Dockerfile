# syntax=docker/dockerfile:1.4
#
# Habitat Container — unified server.
#
# Single port exposes: MCP tools (/mcp), LLM chat (/api/chat), web UI (/), health (/health).
# Mount a volume at /data for persistent state (config, sessions, skills, tools).
# Set HABITAT_API_KEY to enable bearer token auth on /api/* and /mcp.
#
# Build (from monorepo root):
#   docker build -t habitat -f packages/habitat/Dockerfile .
#
# Run (standalone):
#   docker run -p 7430:8080 -v habitat-data:/data habitat
#   docker run -p 7430:8080 -e GOOGLE_GENERATIVE_AI_API_KEY=... habitat
#
# Run (managed by Gaia): Gaia assigns ports in the 7440+ range automatically.

FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

# Install git, ripgrep, curl, and CA certs (needed by habitat tools + HTTPS + mise)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for Gaia to manage child containers via mounted socket).
# Use the build host's arch ($(uname -m) → x86_64 | aarch64) — the static
# download paths use those names — so the image runs on amd64 AND arm64 hosts.
RUN curl -fsSL "https://download.docker.com/linux/static/stable/$(uname -m)/docker-27.3.1.tgz" | \
    tar xz -C /usr/local/bin --strip-components=1 docker/docker

# Install mise (universal runtime/package manager)
RUN curl https://mise.run | sh && \
    ln -s /root/.local/bin/mise /usr/local/bin/mise

ENV MISE_YES=1
ENV MISE_DATA_DIR=/opt/mise
ENV PATH="/opt/mise/shims:${PATH}"

WORKDIR /habitat

COPY pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/protocols/package.json ./packages/protocols/
COPY packages/sessions/package.json ./packages/sessions/
COPY packages/cli/package.json ./packages/cli/
COPY packages/evaluation/package.json ./packages/evaluation/
COPY packages/habitat/package.json ./packages/habitat/
COPY packages/ui/package.json ./packages/ui/
COPY packages/umwelten/package.json ./packages/umwelten/
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN printf '%s\n' 'package-import-method=copy' > .npmrc
RUN --mount=type=cache,id=pnpm-habitat,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Copy all workspace source (needed for tsx to resolve @umwelten/* imports)
COPY packages ./packages/
COPY packages/habitat/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data volume — habitat work directory
VOLUME /data

# Default environment
ENV NODE_ENV=production
ENV HABITAT_WORK_DIR=/data
ENV PORT=8080
# Session co-location (#118 / PRD #113): every runtime's native logs live
# under the data volume. Claude Code (claude-sdk runtime) honors
# CLAUDE_CONFIG_DIR, so its projects/<cwd>/<session>.jsonl traces land in
# /data/claude-config/ — reachable by session egress like habitat sessions.
ENV CLAUDE_CONFIG_DIR=/data/claude-config

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "packages/cli/src/entry.ts", "habitat", "serve", "--port", "8080", "--host", "0.0.0.0", "--skip-onboard"]
