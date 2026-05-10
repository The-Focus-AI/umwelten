# Habitat Runtime — Step-by-step testing guide

A guided walkthrough for exercising the new multi-agent habitat runtime
(spec: [`habitat-runtime.md`](./habitat-runtime.md)). Each step is
copy-paste runnable and produces a check you can verify before moving on.

The first three steps require **no Docker** — they exercise the policy,
identity, manifest, and skill-discovery surfaces against a local
`habitat serve`. Step 4 onward layers on Gaia and Docker.

---

## 0. Prerequisites

```bash
node --version    # v22 or v24+ (v25 also works)
pnpm --version
docker --version  # only needed from Step 4 onward
```

`.env` at the repo root must contain at least:

```
GOOGLE_GENERATIVE_AI_API_KEY=...
# Optional but enables the Gaia auto-seed test in Step 4:
GITHUB_TOKEN=ghp_...
```

> **Note** — the CLI is invoked via the built `dist/` directly because
> `tsx` resolves `__dirname` differently. Use:
> `dotenvx run -- node packages/cli/dist/entry.js ...`

---

## 1. Build + smoke

```bash
pnpm install
pnpm build
pnpm test:run
```

**Expected:** `Test Files 73 passed (73)  Tests 884 passed (884)`.

If this passes, every Phase 1–6 unit test (vault, recursion guard,
skill inspector, manifest parser, read-mode policy, Gaia seed) is green.

---

## 2. Build the test fixture

A throwaway work-dir with a multi-agent config, a real on-disk skill,
and an `mcp-agent` whose `agent-manifest.json` actually validates.

```bash
./examples/habitat-runtime-test/build-fixture.sh /tmp/habitat-runtime-test
```

The script prints what it set up. Inside `/tmp/habitat-runtime-test`:

```
config.json                              # 3 agents, scopeTemplate, identities
STIMULUS.md                              # persona
secrets.json                             # GITHUB_TOKEN + TAVILY_API_KEY (mode 0600)
skills/tavily-search/                    # SKILL.md + scripts referencing env/CLI
agents/standards/repo/                   # mode:read target
agents/frontend/repo/                    # mode:write target
agents/twitter-mcp/repo/                 # kind:mcp-agent + agent-manifest.json + public/index.html
```

You can re-run the script any time — it nukes & rebuilds the fixture.

---

## 3. Start `habitat serve` against the fixture

In **Terminal A**:

```bash
dotenvx run -- node packages/cli/dist/entry.js habitat serve \
  --work-dir /tmp/habitat-runtime-test \
  --port 7430 \
  --skip-onboard \
  --all-tools
```

You should see:

```
[container] Habitat Runtime Test at http://0.0.0.0:7430
[container]   /mcp         — MCP tools (45)
[container]   /a2a         — A2A agent endpoint
...
[container]   Auth: open (set HABITAT_API_KEY to enable bearer auth)
```

`--all-tools` registers the full `standardToolSets` (including the new
`inspectToolSet`). Without it you still get the new `containerToolSets`
which now also includes inspection.

> **Chat UI:** open `http://localhost:7430/` in a browser to use the
> habitat's web chat against the test fixture. The same port serves
> `/api/*`, `/mcp`, `/a2a`, `/files/*`, and the new `/agents/<id>/*`
> routes — they all coexist on one server.

### 3a. Provisioning manifest — **the headline endpoint**

In **Terminal B**:

```bash
curl -s localhost:7430/api/manifest | jq
```

**Expected** (abbreviated):

```jsonc
{
  "name": "Habitat Runtime Test",
  "agents": [
    { "id": "standards",   "kind": "repo",       "mode": "read",  "scopes": [{"kind":"git-read", ...}] },
    { "id": "frontend",    "kind": "repo",       "mode": "write", "scopes": [{"kind":"git-write", ...}] },
    { "id": "twitter-mcp", "kind": "mcp-agent",  "mode": "write", ... }
  ],
  "scopeTemplates": {
    "org-readonly": { "kind": "git-read", "env": ["GITHUB_TOKEN"], ... }
  },
  "skills": [
    {
      "name": "tavily-search",
      "requirements": {
        "envVars": [{ "name": "TAVILY_API_KEY", ... }, { "name": "GITHUB_TOKEN", ... }],
        "cliTools": [{ "name": "curl", ... }, { "name": "cargo", ... }]
      }
    }
  ],
  "aggregate": {
    "envVars": [
      { "name": "GITHUB_TOKEN",   "reason": "referenced in scripts/install.sh" },
      { "name": "TAVILY_API_KEY", "reason": "referenced in SKILL.md (declared in section)" }
    ],
    "cliTools": [
      { "name": "cargo", "reason": "invoked in scripts/install.sh" },
      { "name": "curl",  "reason": "invoked in scripts/install.sh" }
    ]
  }
}
```

This proves: **(a)** every agent surfaces its kind/mode/identity,
**(b)** scope templates flow through, **(c)** skills are inspected
without modifying SKILL.md, **(d)** requirements are aggregated.

### 3b. Per-agent endpoints

```bash
curl -s localhost:7430/api/agents | jq
curl -s localhost:7430/api/agents/twitter-mcp/manifest | jq
curl -s localhost:7430/api/agents/standards/requirements | jq
```

### 3c. mcp-agent public surface

```bash
# Static UI (served from agent's publicUiDir)
curl -s localhost:7430/agents/twitter-mcp/

# Manifest as plain JSON
curl -s localhost:7430/agents/twitter-mcp/manifest.json | jq

# MCP endpoint stub — returns 501 until @umwelten/server/mcp-serve is wired
curl -si localhost:7430/agents/twitter-mcp/mcp | head -5
```

**Expected:**
- Static UI returns the demo HTML.
- Manifest returns the parsed `agent-manifest.json`.
- `/mcp` returns **501 Not Implemented** with a diagnostic body containing
  `"manifest": {...}` to prove the manifest was loaded.

### 3d. Read-mode enforcement (write_file)

The test habitat is open auth, so we can call any tool by hitting `/api/chat`
with a prompt that asks the model to call `write_file`. To check the policy
without an LLM in the loop, write a 5-line node script:

```bash
cat > /tmp/test-readmode.mjs <<'JS'
const r = await fetch("http://localhost:7430/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: {
      name: "write_file",
      arguments: { path: "BLOCKED.md", content: "should be rejected", agentId: "standards" }
    }
  }),
});
console.log(await r.text());
JS
node /tmp/test-readmode.mjs
```

**Expected:** the response contains `"READ_ONLY_AGENT"` and `"agent": "standards"`.
The same call against `agentId: "frontend"` succeeds.

### 3e. Skill inspection via the tool

```bash
cat > /tmp/test-inspect.mjs <<'JS'
const r = await fetch("http://localhost:7430/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "inspect_skill", arguments: { skillName: "tavily-search" } }
  }),
});
console.log(await r.text());
JS
node /tmp/test-inspect.mjs
```

**Expected:** structured result with `envVars: [TAVILY_API_KEY, GITHUB_TOKEN]`
and `cliTools: [curl, cargo]`. (Same data as 3a but via the AI-callable tool.)

When you're done, `Ctrl-C` Terminal A.

---

## 4. Gaia auto-seed (`org-readonly` propagation)

Requires `GITHUB_TOKEN` in `.env`.

In **Terminal A**:

```bash
dotenvx run -- node packages/cli/dist/entry.js habitat gaia \
  --data-dir /tmp/gaia-test \
  -p google -m gemini-3-flash-preview
```

In **Terminal B**, find the Gaia chat URL it printed (e.g.
`http://localhost:7420/?token=gaia_...`), open it, and chat:

> Create a habitat called test-bot using google / gemini-3-flash-preview, no git URL.

The response should include:
> `Auto-seeded org-readonly identity (GITHUB_TOKEN).`

**Verify** the seeded config from disk:

```bash
cat /tmp/gaia-test/registry.json | jq '.habitats[0].config | {scopeTemplates, agents}'
```

**Expected:**

```jsonc
{
  "scopeTemplates": {
    "org-readonly": { "kind": "git-read", "env": ["GITHUB_TOKEN"], ... }
  },
  "agents": [
    {
      "id": "org-readonly",
      "kind": "credential-only",
      "mode": "read",
      "identity": { "principal": "org-readonly", "scopes": [{"source": "org-readonly", ...}] }
    }
  ]
}
```

`Ctrl-C` Terminal A when done.

---

## 5. Export / import a habitat (reproducibility)

Same Gaia from Step 4. In the chat:

> Export the habitat test-bot.

Copy the JSON blob it returns. Then:

> Import this blob as test-bot-imported: `<paste the blob>`

Verify both habitats now exist:

```bash
cat /tmp/gaia-test/registry.json | jq '[.habitats[].id]'
```

**Expected:** `["test-bot", "test-bot-imported"]` — same config shape,
no secret values were ever in the blob (only names).

---

## 6. Cross-agent recursion guard (Phase 5)

Quickest way to verify the recursion guard is via the unit test:

```bash
pnpm test:run packages/habitat/src/identity/agent-call-context
```

**Expected:** 6 tests pass — including "rejects cycles" and
"rejects when chain reaches max depth".

For an end-to-end test with two real sub-agents talking to each other,
register both as agents and ask the host to chain `agent_ask` calls. The
guard kicks in at depth 3 with `AGENT_CALL_DEPTH_EXCEEDED`, or earlier
with `AGENT_CALL_CYCLE` if the chain revisits an agent.

---

## 7. Docker entrypoint (multi-agent provisioning)

The new `entrypoint.sh` clones every agent in `config.agents[]` into its
own `/data/agents/<id>/repo` with per-agent env scoping.

```bash
# 1. Build the habitat image
docker build -t habitat .

# 2. Use the fixture's config.json + secrets.json as a seed volume
docker volume create habitat-runtime-test-vol
docker run --rm \
  -v habitat-runtime-test-vol:/data \
  -v /tmp/habitat-runtime-test:/seed:ro \
  alpine sh -c 'cp /seed/config.json /data/config.json && cp /seed/secrets.json /data/secrets.json && chmod 600 /data/secrets.json'

# 3. Edit config.json to point gitRemote at a real public repo so the clone succeeds.
#    (The fixture's agents have no gitRemote; entrypoint will skip them safely.)
#    For a quick smoke test, just check the entrypoint runs:

docker run --rm \
  -v habitat-runtime-test-vol:/data \
  -p 7440:8080 \
  habitat \
  /bin/sh -c '/habitat/entrypoint.sh echo "entrypoint completed"' 2>&1 | head -30
```

**Expected output** (one block per agent):

```
[entrypoint] Skipping clone for org-readonly (kind=credential-only).
[entrypoint] Agent standards has no gitRemote; skipping clone.
[entrypoint] Agent frontend has no gitRemote; skipping clone.
...
entrypoint completed
```

For a real clone test, add a `gitRemote` to one agent in the fixture
config and re-run — you should see `Cloning agent <id> ...` and the
agent's repo show up at `/data/agents/<id>/repo` inside the container.

---

## 8. mcp-agent end-to-end via Gaia (manual)

Once you've created an `mcp-agent` with a real `agent-manifest.json` and
a `gitRemote`, Gaia will:

1. Clone the repo into the container's `/data/agents/<id>/repo`.
2. Detect the manifest on next `habitat serve` boot.
3. Mount `/agents/<id>/manifest.json` and the static UI.
4. Stub `/agents/<id>/mcp` with a 501 + manifest body.

Wiring `/agents/<id>/mcp` to the actual `@umwelten/server/mcp-serve`
implementation is the deferred follow-up — once landed, the same URL
will return live MCP traffic instead of a stub.

---

## What's verified by the end of this guide

| Concern                                    | Verified in |
|--------------------------------------------|-------------|
| Type extensions compile + ship             | Step 1      |
| Skill inspector discovers env + CLI tools  | Steps 3a, 3e |
| Aggregated provisioning manifest           | Step 3a     |
| Per-agent endpoints + identity surfacing   | Step 3b     |
| `mcp-agent` manifest parsing + UI mounting | Step 3c     |
| Read-mode policy enforcement               | Step 3d     |
| Gaia auto-seed of `org-readonly`           | Step 4      |
| Export / import (no secret leakage)        | Step 5      |
| Recursion guard depth + cycle              | Step 6      |
| Per-agent provisioning in entrypoint.sh    | Step 7      |
| `mcp-agent` MCP mount stub (501)           | Step 3c     |

If a step fails, the unit tests for that area (`pnpm test:run packages/habitat`)
should help isolate it before debugging the live HTTP path.
