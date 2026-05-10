# Habitat Runtime

> What a habitat is *inside the container*: agents, identities, the two-plane MCP server, and the reproducibility model. Companion to [habitat-deployment](./habitat-deployment.md), which covers where habitats are deployed.
>
> **Hands-on validation:** see [habitat-runtime-testing](./habitat-runtime-testing.md) for a copy-paste walkthrough that exercises every section of this spec end-to-end.

## Context

A habitat is a single Docker container with one persistent volume (`/data`) that hosts an agent runtime. Today (`packages/habitat/src/`) it is mostly built as a *single*-agent system: one persona, one git repo (`HabitatConfig.gitUrl` → `/data/project`), one set of secrets, one HTTP surface (`packages/habitat/src/container-server.ts`) gated by a single bearer (`HABITAT_API_KEY`).

Real-world use breaks that mold:

- A team wants a company-standards repo (read-only) and a project repo (read-write) inside the same habitat, with a sub-agent that can verify the project against the standards.
- Some habitats are themselves MCP servers (`examples/twitter-mcp/`, `examples/oura-mcp/`) — they expose tools to *end users* over OAuth, not just to the operator over a bearer token.
- A skill (e.g. web search) needs `TAVILY_API_KEY`, but the SKILL.md spec is fixed and cannot be extended to declare that — discovery must be inferred from the skill's code.

This spec defines the runtime that supports those cases without breaking the existing one-container / one-volume / destroy-and-reprovision invariant.

## Invariants

These are non-negotiable. They keep the operational story simple.

- **One habitat = one container = one volume.** No bind mounts, no per-repo Docker volumes, no `:ro` kernel mounts. State lives in `/data`.
- **Reset == reprovision.** `docker rm -f <container> && docker volume rm <volume>` followed by `start_habitat` from `config.json + secrets.json` must rebuild an indistinguishable container. This is how trust degrades gracefully.
- **A habitat hosts N agents.** "Agent" = anything with its own identity inside the habitat: a code repo, a credential bundle, an MCP-server module. Sub-agents live at `/data/agents/<id>/`.
- **Identity attaches to the agent**, not the habitat. The habitat's own secret store holds infrastructure secrets (LLM keys, the org git PAT); each agent's vault holds its operational secrets.
- **Skill spec stays untouched.** SKILL.md frontmatter is a fixed external standard; we discover env requirements by scanning skill code, never by extending the schema.
- **Configuration is a value object.** `config.json` + `secrets.json` (and per-agent equivalents under `agents/<id>/`) is the complete habitat definition — exportable, importable, snapshot-able.

## Design

### Phase 1 — Multi-agent inside one container

`HabitatConfig.agents` already exists and `agent_clone` (`packages/habitat/src/tools/agent-runner-tools.ts`) already creates `/data/agents/<id>/repo/` and registers the entry. What's missing:

1. **Extend `AgentEntry` (`packages/habitat/src/types.ts`)** with:

   - `kind?: "repo" | "credential-only" | "mcp-agent" | "remote-habitat"`
   - `mode?: "read" | "write"` (default: `"write"`)
   - `identity?: AgentIdentity`
   - `requirements?: AgentRequirements` (discovered; see Phase 3)
   - `surface?: AgentSurface` (see Phase 4 for `mcp-agent` kind)

2. **`HabitatConfig.scopeTemplates`** — named, reusable identity scopes (e.g. `org-readonly`) declared once at the habitat level and referenced by `identity.scopes[*].source`.

3. **Read/write enforcement is policy, not isolation.** When an agent's `mode === "read"`:

   - `write_file` (`packages/habitat/src/tools/file-tools.ts`) returns `{ error: "READ_ONLY_AGENT", agent: id }` when the resolved path is inside that agent's `projectPath`.
   - `bashTool` (`packages/habitat/src/tools/exec-tools.ts`) running with `cwd` inside a read agent's repo refuses to inherit any `kind: "git-write"` scope into env.
   - `agent_ask_claude` (`packages/habitat/src/tools/agent-runner-tools.ts`) forces `allowedTools` to the read-only set (`Read`, `Grep`, `Glob`) regardless of caller.

4. **Entrypoint loops over agents.** `entrypoint.sh` iterates `config.agents[]`: resolve identity → export scoped env → `git clone gitRemote` → `mise install` per repo. Same per-agent flow used for skills via `npx skills install`.

### Phase 2 — Agent identity & scopes

```typescript
interface AgentIdentity {
  principal: string;                 // stable identity slug, e.g. "frontend-deploy"
  vault?: AgentVaultRef;             // where credentials live
  scopes: AgentScope[];              // what credentials this agent gets
}

interface AgentVaultRef {
  backend: "inline" | "habitat" | "1password";
  // inline    → /data/agents/<id>/secrets.json (mode 0600)
  // habitat   → /data/secrets.json (the container-level store)
  // 1password → resolved via `op` CLI on host (future)
  ref?: string;                      // backend-specific locator
}

interface AgentScope {
  kind: "git-read" | "git-write" | "api-key" | "ssh" | "deploy-key";
  env: string[];                     // env var names to export when this agent runs
  source?: string;                   // scopeTemplate id this scope was inherited from
}
```

`AgentEntry.secrets?: string[]` (the existing field) stays as a backward-compat alias for `identity.scopes[*].env`.

The vault interface is single-method:

```typescript
interface AgentVault {
  resolve(name: string): Promise<string | undefined>;
}
```

Three implementations to start: `InlineVault` (per-agent file), `HabitatVault` (container-level — already exists as `loadSecrets`/`saveSecrets` in `packages/habitat/src/secrets.ts`), and `OnePasswordVault` (deferred).

**Identity resolution at git-clone time.** The cleanest path is a per-agent `GIT_ASKPASS` script the entrypoint generates that resolves the right scope on demand. Avoids polluting `~/.ssh/config` or global git credential helpers.

### Phase 2.1 — Gaia ships a built-in `org-readonly` agent

Gaia is itself a habitat. On first boot it auto-seeds **one** special agent that child habitats can inherit:

```jsonc
// Gaia's own config.json — auto-created on `habitat gaia` first run
{
  "name": "Gaia",
  "agents": [
    {
      "id": "org-readonly",
      "name": "Org Read-Only",
      "kind": "credential-only",
      "mode": "read",
      "identity": {
        "principal": "org-readonly",
        "vault": { "backend": "habitat" },
        "scopes": [{ "kind": "git-read", "env": ["GITHUB_TOKEN"] }]
      }
    }
  ],
  "scopeTemplates": {
    "org-readonly": { "from": "agents/org-readonly", "kind": "git-read", "env": ["GITHUB_TOKEN"] }
  }
}
```

- Gaia's onboarding wizard prompts once for `GITHUB_TOKEN` and stores it in the master vault.
- `Gaia.create_habitat()` automatically binds `org-readonly` to every new habitat unless `--no-org-pull` is passed.
- The token is `kind: "git-read"` only — write operations against the org are blocked even if the env var is set, because policy checks `scope.kind`.

This is the smallest first identity and the one used most often for org pulls.

### Phase 3 — Skill env discovery (without touching SKILL.md)

The SKILL.md spec is fixed. Use the same LLM-inspection pattern that `agent_configure` (`packages/habitat/src/tools/agent-runner-tools.ts`) already uses for projects, applied to skills:

1. **`inspect_skill(name)` tool** — runs an LLM pass over the skill's directory, emits the same shape as `agentConfigureSchema` in `agent-runner-tools.ts` (`requiredEnvVars`, `requiredCliTools`, `authRequirements`, `hostIntegrations`). Result is named `SkillRequirementsContract` (same shape, different semantic name).
2. **Cache** results at `/data/.skill-requirements/<skill-name>.json` keyed by content hash; re-scan only when the skill files change.
3. **Trigger automatically** on skill add (`add_skill`, `npx skills install`, local `skills/` directory load) — discovery is opt-out, not opt-in.
4. **Symmetric for agents.** Apply the same scanner to a freshly-cloned `kind: "repo"` agent and persist the result on `AgentEntry.requirements`. `agent_configure` already does this; persist it on the entry rather than only in MEMORY.md.

The aggregated view is a **provisioning manifest** the habitat exposes:

```typescript
interface ProvisioningManifest {
  requiredSecrets: { name: string; reason: string; required: boolean; source: string }[];
  requiredCliTools: { name: string; reason: string; required: boolean; source: string }[];
  agents: AgentEntry[];
  toolSets: string[];
  recommendedRuntimes: string[];     // node@22, python@3.12 — from mise.toml across agents
  provider?: string;
  model?: string;
}
```

`Habitat.computeRequirements()` unions: habitat-level config + per-agent requirements + per-skill requirements. Exposed at `GET /api/manifest`. This is what Gaia uses to render "Setup status" panels for each managed habitat.

### Phase 4 — Two-plane token-routed MCP server

The single `/mcp` endpoint serves two audiences distinguished by token shape. Three planes total:

```
Incoming request → look at Authorization: Bearer <X>
  ├─ X matches HABITAT_API_KEY                      → ADMIN plane
  ├─ X is a token issued by an embedded OAuth AS    → USER plane (per agent)
  └─ no token / unknown                             → PUBLIC plane (login pages, splash)
```

The infrastructure exists today but has not been composed:

- **Admin plane** is current `container-server.ts` behavior: `bearerAuth(HABITAT_API_KEY)` (`packages/habitat/src/web/auth/bearer-auth.ts`) gates `/api/*`; `/mcp` exposes the habitat tools (file ops, secrets, agent management).
- **User plane** is what `packages/server/src/mcp-serve/` implements for standalone `oura-mcp` / `twitter-mcp`: its own OAuth 2.1 AS (`packages/server/src/mcp-serve/oauth/`), dynamic client registration, PKCE, upstream-token chaining (`UpstreamOAuthProvider` in `packages/server/src/mcp-serve/types.ts`), per-user token storage (`McpServeStore`).
- **Public plane** is the `staticRoot` mechanism in `packages/server/src/mcp-serve/server.ts` — an unauthenticated landing page (the "Connect your account" splash).

#### `kind: "mcp-agent"` — agents that publish their own surface

An agent's repo can declare an `agent-manifest.json` describing what it serves:

```jsonc
// inside the agent's repo, e.g. examples/twitter-mcp/habitat/agent-manifest.json
{
  "kind": "mcp-agent",
  "publicUiDir": "public",
  "publicMcp": true,
  "publicAuth": {
    "kind": "oauth-server",
    "upstreamProvider": "./dist/twitter-provider.js",
    "registerTools": "./dist/twitter-tools.js",
    "store": { "driver": "sqlite", "path": "./data/oauth.db" }
  },
  "publicRoutes": ["/oauth/*", "/.well-known/*"]
}
```

On `agent_clone`, the habitat:

1. Clones the agent's repo (existing).
2. Reads `agent-manifest.json`. If `kind: "mcp-agent"`, dynamically imports the provider + registrar (no second process required for the happy path).
3. Mounts the agent's `publicUiDir` and registers its OAuth + MCP routes on the public/user planes.
4. Updates `/api/manifest` so the admin sees the public plane is now "Twitter Connect" (or similar) instead of the default habitat splash.

If multiple `mcp-agent`s coexist:

- Each gets its own AS path (`/twitter/oauth/*`, `/oura/oauth/*`) — keeps token namespaces separate.
- The public root (`/`) shows a chooser unless the operator pins a primary via `set_primary_public_agent`.
- Admin's `/mcp` (with `HABITAT_API_KEY`) federates everything — admin sees `twitter/*`, `oura/*`, plus all native habitat tools.

**Walk-through: configuring a Twitter habitat end-to-end**

1. Operator (Gaia chat): create habitat `twitter`, expose on host port.
2. Container starts with `agents: []`. Admin plane up; public plane shows default splash; `/mcp` returns admin tools only.
3. Operator (with admin bearer): `agent_clone` the twitter-mcp repo with credentials set → reads `agent-manifest.json` → mounts `/`, registers `/oauth/*` and OAuth-protected `/mcp`.
4. End user (Claude Code): `claude mcp add --transport http twitter https://<host>/mcp` → 401 + `WWW-Authenticate` → browser OAuth → MCP bearer → user-scoped `twitter/*` tools.
5. Operator: same `/mcp` URL with `Authorization: Bearer $HABITAT_API_KEY` → admin tools + federated `twitter/*` + agent CRUD.

The key property: operator and end user use the **same `/mcp` URL**. The token type dispatches.

#### Front-end implications

Three new UI surfaces in `packages/habitat/src/container-ui/`:

1. **Agents tab** — list with kind, mode, identity, scopes, requirements, recent sessions, tool catalog (if MCP-bearing), repo path (if code-bearing).
2. **MCP federation panel** — for habitats with `mcp-agent` agents: native tools vs per-agent federated tools, re-auth / disconnect per upstream.
3. **Manifest / setup-status panel** — driven by `/api/manifest`: provider, org token, per-agent gaps, MCP OAuth status.

### Phase 5 — Cross-agent inspection

Today `SUB_AGENT_TOOL_DENYLIST` (`packages/habitat/src/habitat-agent.ts`) blocks `agent_ask` from inside a sub-agent, so the standards agent cannot ask the frontend agent anything. Two changes unblock this:

1. **Drop `agent_ask` from the denylist.** Sub-agents inherit the tool.
2. **Add a recursion guard.** Thread a `callChain: string[]` through the tool execution context. `agent_ask` rejects with `AGENT_RECURSION` if the chain exceeds depth N (default: 3) or revisits an agent already in the chain.

This unlocks scenarios like *standards agent verifies that the frontend agent follows our conventions* without enabling infinite loops.

### Phase 6 — Reproducibility

The seed model already proves a habitat is recreatable from files (`buildSeedFiles` in `packages/habitat/src/gaia/gaia-tools.ts`). Generalize and expose:

1. **`export_habitat(id, { includeSecrets, includeSessions })`** — tarball with `config.json`, `secrets.manifest.json` (names only), optional `secrets.json`, `STIMULUS.md`, `tools/`, per-agent `identity.json` and optional secrets.
2. **`import_habitat(path)`** — re-seed into a fresh volume; if secrets are missing, surface manifest gaps.
3. **Sessions** default out of export; opt-in with `includeSessions=true`.

Combined with existing `rebuild_habitat` (`packages/habitat/src/gaia/gaia-tools.ts`), destroy-and-recreate should round-trip when config + secrets are restored.

## Test plan

End-to-end, mostly without LLMs (only conversational steps need `dotenvx`):

1. **Image + base container** — `docker build -t habitat .`, run with volume + `HABITAT_API_KEY`.
2. **`GET /api/manifest`** — empty habitat reports infra needs.
3. **Read-only agent** — `agent_clone` standards repo with `mode: read` and org scope.
4. **Writable agent** — `agent_clone` project repo with `mode: write`.
5. **Read-only policy** — `write_file` into standards repo must fail; into frontend repo must succeed.
6. **Cross-agent** — `agent_ask` standards → ask frontend via nested `agent_ask`; expect a coherent report.
7. **`inspect_skill`** — discover e.g. `TAVILY_API_KEY` without changing SKILL.md; cache under `.skill-requirements/`.
8. **Manifest aggregates** — union of habitat + agents + skills with provenance.
9. **`mcp-agent`** — add twitter-mcp; public plane shows connect UI; user OAuth → user-plane MCP tools.
10. **Destroy + restore** — volume rm + restore tarball + start; `/api/manifest` matches pre-destroy.
11. **Recursion guard** — nested `agent_ask` beyond depth N must fail with `AGENT_RECURSION`.

Must-fail-loudly: step 5 (read-only) and step 10 (round-trip).

## Open questions

1. **In-flight sessions during destroy.** Sessions live under `/data/sessions/` so they are lost with the volume. Export before destroy, or accept loss?
2. **Sub-agent env shaping.** All sub-agents share `process.env`. Accept habitat-wide trust boundary, or add per-sub-agent env filtering?
3. **OAuth AS lazy-init.** Always boot OAuth AS plumbing, or mount routes lazily on first `mcp-agent`? Lazy avoids unused AS state; first install may rebind routes without container restart.
4. **Per-host vs per-agent OAuth AS.** Each `mcp-agent` runs its own AS (good isolation; user may OAuth twice for two agents on same host). Document explicitly.
5. **Unified MCP user across multiple `mcp-agent`s.** One habitat token mapping to N upstream tokens is nicer UX but new infrastructure; defer.
6. **`HABITAT_API_KEY` rotation and audit.** Static admin bearer; mitigate with rotation + append-only admin audit (align with `habitat-deployment.md` Phase 4 direction).
7. **1Password / external vault.** `AgentVaultRef.backend: "1password"` — resolver contract, caching, rotation — implement after inline + habitat vaults work.

## Critical files to modify

- `packages/habitat/src/types.ts` — `AgentIdentity`, `AgentVaultRef`, `AgentScope`, `AgentRequirements`, `AgentSurface`; extend `AgentEntry`; `HabitatConfig.scopeTemplates`.
- `packages/habitat/src/habitat.ts` — `computeRequirements()`, per-agent vault resolution.
- `packages/habitat/src/habitat-agent.ts` — remove `agent_ask` from `SUB_AGENT_TOOL_DENYLIST`; thread `callChain` through tool context.
- `packages/habitat/src/tools/agent-runner-tools.ts` — `agent_clone` accepts `kind`, `mode`, `identity`; reads `agent-manifest.json`; `inspect_skill`; `set_primary_public_agent`.
- `packages/habitat/src/tools/file-tools.ts` — `READ_ONLY_AGENT` on `write_file` for read-mode agents.
- `packages/habitat/src/tools/exec-tools.ts` — scrub write-scoped env when cwd is inside read agent.
- `packages/habitat/src/tools/provision-tools.ts` — extend `provision_status` for per-agent state.
- `packages/habitat/src/container-server.ts` — token-routing (admin / user / public); `GET /api/manifest`; mount `mcp-serve` routes for `mcp-agent` kind.
- `packages/habitat/src/web/auth/` — classify bearers (admin vs MCP-issued user).
- `packages/habitat/src/onboard.ts` — optional Gaia-first-boot seed for `org-readonly` + `scopeTemplates`.
- `entrypoint.sh` — loop `config.agents[]`, per-agent `GIT_ASKPASS`, clone, mise.
- `packages/habitat/src/gaia/gaia-tools.ts` — `export_habitat`, `import_habitat`, `inspect_habitat`, optional `rotate_admin_key`.
- **New modules (suggested):** `packages/habitat/src/identity/` (vaults, askpass generator), `packages/habitat/src/inspect/` (agent + skill requirements), `packages/habitat/src/mcp-agent/` (manifest parser, mount into HTTP server).

## Verification

- **Unit:** vault resolution; `write_file` read-only rejection; `inspect_skill` fixture; recursion guard at depth N.
- **Integration:** test plan steps 1–11 against Dockerized habitat in CI; step 10 is the canary.
- **E2E:** habitat with `repo` + `mcp-agent` agents; external MCP client OAuth; operator cross-agent `agent_ask`.

## Relationship to [habitat-deployment](./habitat-deployment.md)

This document covers *what a habitat is at runtime*. `habitat-deployment.md` covers *where* habitats run (GCP, Fly, Vercel, VPS, etc.). They share `HabitatConfig` and related types; deployment-target caveats (serverless limits, sidecars) stay in the deployment doc.
