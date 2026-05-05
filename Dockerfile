# syntax=docker/dockerfile:1.4
#
# Habitat MCP Server container.
#
# Exposes all habitat tools over Streamable HTTP at /mcp.
# Mount a volume at /data for persistent state (config, sessions, skills, tools).
#
# Build:
#   docker build -t habitat .
#
# Run:
#   docker run -p 8080:8080 -v ./my-habitat:/data habitat
#   docker run -p 8080:8080 -e GOOGLE_GENERATIVE_AI_API_KEY=... habitat

FROM node:22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

# ── Build stage ──────────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN printf '%s\n' 'package-import-method=copy' > .npmrc
RUN --mount=type=cache,id=pnpm-habitat,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY src ./src/
RUN pnpm run build

# ── Production stage ─────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

# Install git and ripgrep (needed by habitat tools)
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./

# Data volume — habitat work directory
VOLUME /data

# Default environment
ENV NODE_ENV=production
ENV HABITAT_WORK_DIR=/data
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/cli/entry.js", "habitat", "serve", "--port", "8080", "--host", "0.0.0.0", "--skip-onboard"]
