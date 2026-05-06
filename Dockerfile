# syntax=docker/dockerfile:1.4
#
# Habitat Container — unified server.
#
# Single port exposes: MCP tools (/mcp), LLM chat (/api/chat), web UI (/), health (/health).
# Mount a volume at /data for persistent state (config, sessions, skills, tools).
# Set HABITAT_API_KEY to enable bearer token auth on /api/* and /mcp.
#
# Build:
#   docker build -t habitat .
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

# Install mise (universal runtime/package manager)
RUN curl https://mise.run | sh && \
    ln -s /root/.local/bin/mise /usr/local/bin/mise

ENV MISE_YES=1
ENV MISE_DATA_DIR=/opt/mise
ENV PATH="/opt/mise/shims:${PATH}"

WORKDIR /habitat

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN printf '%s\n' 'package-import-method=copy' > .npmrc
RUN --mount=type=cache,id=pnpm-habitat,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY src ./src/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data volume — habitat work directory
VOLUME /data

# Default environment
ENV NODE_ENV=production
ENV HABITAT_WORK_DIR=/data
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "src/cli/entry.ts", "habitat", "serve", "--port", "8080", "--host", "0.0.0.0", "--skip-onboard"]
