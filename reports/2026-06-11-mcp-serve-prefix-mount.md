# Mounting mcp-serve under a path prefix (per-agent MCP mount)

**Date:** 2026-06-11 · **Issue:** #121 · **Scope:** wiring `/agents/<id>/mcp` in the
habitat container server to `@umwelten/protocols/mcp-serve`.

Complements `2026-05-04-a2a-mcp-skills-implementation.md` (A2A-outside / MCP-inside
composition, OAuth task lifecycle) and `2026-05-07-acp-a2a-mcp-agent-protocols.md`
(protocol comparison). Neither covers serving an OAuth-backed MCP endpoint **under a
path prefix on a shared host**, which is the whole game here. This report records the
findings that drove the implementation.

## 1. mcp-serve is prefix-ready except for its router

Every handler in `packages/protocols/src/mcp-serve/` (`handleMcpRequest`,
`handleProtectedResource`, `handleAuthServerMetadata`, `handleRegister`,
`handleAuthorize`, `handleUpstreamCallback`, `handleToken`) takes a `baseUrl`/
`publicBaseUrl` string and derives every emitted URL from it:

- 401 `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`
- AS metadata: `authorization_endpoint: <base>/oauth/authorize`, `token_endpoint`,
  `registration_endpoint`
- upstream callback: `<base>/oauth/upstream-callback`

Only `createMcpServer()`'s internal router hardcodes root paths (`/mcp`, `/oauth/*`,
`/.well-known/*`). So a prefix mount needs **no changes to any handler** — just a
prefix-relative dispatcher that passes `baseUrl = <origin>/agents/<id>`. That is what
`mcp-serve/mount.ts` (`createMcpServeMount`) now provides; `createMcpServer` is the
single-tenant wrapper, the mount is the embeddable multi-tenant form.

## 2. OAuth discovery URL forms — the load-bearing detail

Verified against `@modelcontextprotocol/sdk` **1.29.0** (`dist/esm/client/auth.js`,
`buildDiscoveryUrls`): for an authorization-server issuer **with a path component**
(`https://host/agents/foo`), the client tries, in order:

1. `https://host/.well-known/oauth-authorization-server/agents/foo`  ← RFC 8414 path-inserted
2. `https://host/.well-known/openid-configuration/agents/foo`
3. `https://host/agents/foo/.well-known/openid-configuration`

It **never** tries suffix-style `https://host/agents/foo/.well-known/oauth-authorization-server`.
Consequences for the container server:

- The **root-level path-inserted** route `/.well-known/oauth-authorization-server/agents/<id>`
  is mandatory, or every SDK-based client (including `umwelten mcp chat` and claude.ai
  connectors) fails discovery after the 401.
- Protected-resource metadata is found via the explicit `resource_metadata` URL in the
  401 header (RFC 9728), so the suffix route `/agents/<id>/.well-known/oauth-protected-resource`
  works for that step — but clients that probe without a 401 hint build the
  path-inserted form `/.well-known/oauth-protected-resource/agents/<id>/mcp`, so serve
  both (and the `/agents/<id>` variant without `/mcp`).
- Serving suffix-style AS metadata under the prefix as well is harmless extra compat.

## 3. Manifest → handler wiring

`agent-manifest.json` (parsed by `packages/habitat/src/identity/agent-manifest.ts`)
already declares the full mcp-serve configuration; validation already enforces
`publicAuth` when `publicMcp: true`:

- `publicAuth.upstreamProvider` — repo-relative JS module, `default` or `provider`
  export → `UpstreamOAuthProvider`
- `publicAuth.registerTools` — repo-relative JS module, `default` or `registerTools`
  export → `McpToolRegistrar`
- `publicAuth.store` — `{driver:"neon", envRef}` | `{driver:"sqlite", path}` | omitted

Modules are loaded with `import(pathToFileURL(abs).href)` — agent repos ship built JS
(the manifest doc says "JS module"); TS sources will not load under plain node.

Store resolution (implemented in `packages/habitat/src/agent-mcp-mount.ts`):

- `neon` → `NeonStore(process.env[envRef])`; missing env var is a configuration error
  surfaced as JSON, not a crash.
- `sqlite` → declared in the manifest schema but **no implementation exists** in
  mcp-serve yet; surfaced as a clear "not yet supported" error rather than a silent
  fallback.
- omitted → `MemoryStore` (new, in `mcp-serve/memory-store.ts`) with a logged warning:
  OAuth clients/tokens are lost on restart, fine for dev/demo, not for production.

## 4. Container-server integration notes

- The `/agents/<id>/...` surface is intentionally **not** gated by `HABITAT_API_KEY` —
  the mount's own OAuth 2.1 layer authenticates `/mcp`, and the UI/manifest/OAuth
  endpoints must be publicly reachable for the connector flow. The habitat's own
  bearer-only `/mcp` endpoint is untouched.
- Resolved mounts are cached per agent id (module import + store construction happen
  once); resolution **errors are not cached**, so fixing a manifest/env on disk heals
  on the next request without a restart.
- `getPublicBaseUrl()` (already exported by mcp-serve) honors
  `X-Forwarded-Proto`/`X-Forwarded-Host`, so prefix base URLs are correct behind the
  Gaia proxy / Fly edge.

## 5. Test seams

- `createMcpServeMount` is pure dispatch — testable with stub req/res
  (`node-mocks-http` not needed; plain objects with `writeHead`/`end` capture, same
  idiom as `packages/habitat/src/web/WebAdapter.test.ts`).
- `resolveAgentMcpMount` takes injectable `importModule` / `createNeonStore` deps so
  unit tests stub the framework store and module loading (no Neon, no real files).
- The per-agent routing block is extracted from `startContainerServer`'s closure into
  `handleAgentSurface()` so manifest/static-UI/501-replacement behavior is unit-testable
  against a minimal `{ getAgent, getMcpAgents }` habitat stub, without booting the full
  container server (ChannelBridge, A2A, web routes).
