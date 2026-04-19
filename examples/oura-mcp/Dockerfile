# syntax=docker/dockerfile:1.4
# Build context must be this directory only (do not use .. as context):
#   cd examples/oura-mcp && docker build -t oura-mcp .

FROM node:22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN printf '%s\n' 'package-import-method=copy' > .npmrc
RUN --mount=type=cache,id=pnpm-oura-mcp,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY src ./src/
COPY habitat ./habitat/
COPY public ./public/
RUN pnpm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/habitat ./habitat/
COPY --from=build /app/public ./public/

EXPOSE 8080
CMD ["node", "dist/server.js"]
