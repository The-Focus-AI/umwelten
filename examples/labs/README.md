# Umwelten Prototyping Labs — Prompt-First Explorations

Bite-sized, copy-paste coding-agent tutorials to kick the tires on every layer of `umwelten` (`@earendil-works/pi-*`, `@earendil-works/pi-durable`, `@umwelten/habitat`, `@umwelten/mycel`, `@umwelten/protocols`, `@umwelten/evaluation`, and the `spec-extract` / `verify-deploy` skills).

Each lab gives you:
1. **What You're Testing** — the concrete design question to settle before writing production abstractions.
2. **Visual Target** — a Mermaid architecture/flow diagram plus an ASCII terminal or browser wireframe so you and the coding agent agree on what "looks right."
3. **Spin-Up & Prerequisites** — clean commands to prepare a throwaway workspace or branch.
4. **Coding-Agent Prompt (Copy-Paste)** — an exact prompt naming real repo exports, defaulting to offline `fauxProvider` mocks (with `--live` opt-in), binding strictly to `127.0.0.1`, and requiring an end-to-end smoke check.
5. **Interactive Walkthrough** — hands-on drills and follow-up prompts to push edge cases.
6. **Did the Prompt Work?** — verification checklist + tuning hints if the agent cuts corners.

---

## Lab Catalog

| # | Lab | Design Question | Key Repo Anchors | Visual Surface | Guide |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | Pi Durable Agent Lifecycle Torture Box | How do SQLite checkpoints, `SIGKILL` resume, forks, crons, and Owned/Mounted repo guards behave in practice? | [`durable-habitat.ts`](../../packages/habitat/src/durable/durable-habitat.ts), [`durable-habitats.md`](../../docs/specs/orchestration/durable-habitats.md) | Interactive CLI / TUI Inspector | [01-pi-durable-torture-box.md](./01-pi-durable-torture-box.md) |
| **02** | Authless Dynamic-Grant Mycel + Live LLM Traces | Can zero-login clients mint ephemeral JWT subjects with trace-gated micro-dollar grants? | [`identity.ts`](../../packages/mycel/src/auth/identity.ts), [`dispatch.ts`](../../packages/mycel/src/dispatch.ts), [`run.ts`](../mycel-e2e/run.ts) | Live SSE Trace Waterfall UI | [02-mycel-authless-grants-and-traces.md](./02-mycel-authless-grants-and-traces.md) |
| **03** | Centralized Bearer-Token Vault & HTTP/MCP Proxy | Can agents talk to APIs/MCPs holding zero upstream secrets via a scrubbing proxy? | [`mcp-serve/server.ts`](../../packages/protocols/src/mcp-serve/server.ts), [`remote.ts`](../../packages/protocols/src/mcp/client/remote.ts) | Audit & Redaction Stream Console | [03-centralized-bearer-token-proxy.md](./03-centralized-bearer-token-proxy.md) |
| **04** | Adaptive Dev Result UI & `ui://` Resource Canvas | When do sandboxed `ui://` iframes beat structured JSON views or markdown? | [`ui-resources.ts`](../../packages/habitat/src/ui-resources.ts), [`bench-ui-server.ts`](../../scripts/bench-ui-server.ts) | Warm Paper Browser Canvas | [04-adaptive-dev-result-ui.md](./04-adaptive-dev-result-ui.md) |
| **05** | MCP OAuth 2.1 + `ui://` Round-Trip Lab | Does `RemoteMcpClient` preserve `ui://` HTML and `_meta` cleanly without bloating model tokens? | [`mcp-serve/server.ts`](../../packages/protocols/src/mcp-serve/server.ts), [`remote.ts`](../../packages/protocols/src/mcp/client/remote.ts) | Split "Model vs Human" Inspector | [05-mcp-oauth-and-ui-roundtrip.md](./05-mcp-oauth-and-ui-roundtrip.md) |
| **06** | Many-Tool MCP Scaling Benchmark | At 60+ MCP tools, how much do `tool-search` and `codemode` save vs. direct schemas? | [`coding/extensions.ts`](../../packages/evaluation/src/coding/extensions.ts), [`remote.ts`](../../packages/protocols/src/mcp/client/remote.ts) | Token & Pass@1 Scorecard | [06-mcp-many-tool-scaling.md](./06-mcp-many-tool-scaling.md) |
| **07** | Multi-A2A Peer Mesh & Pi Coordinator | How does coordinator fan-out handle slow peers, `busy` rejections, and shared `contextId`s? | [`examples/multi-a2a/e2e.ts`](../multi-a2a/e2e.ts), [`gaia-host.ts`](../../packages/habitat/src/durable/gaia-host.ts) | Concurrent A2A Task Strip | [07-multi-a2a-mesh-and-delegation.md](./07-multi-a2a-mesh-and-delegation.md) |
| **08** | Universal URL Probe & MCP ↔ A2A Bridge | Can one tool probe any URL (MCP or A2A) and bridge an A2A Habitat onto MCP? | [`discover.ts`](../../packages/protocols/src/discovery/discover.ts), [`mcp-serve/server.ts`](../../packages/protocols/src/mcp-serve/server.ts) | URL Probe & Protocol Card UI | [08-universal-url-probe-and-bridge.md](./08-universal-url-probe-and-bridge.md) |
| **09** | Dynamic Agent Builder → Spec Verify → Prod Ejection | Can we prototype an agent live, extract specs (`spec-extract`), eject a standalone repo, and pass `verify-deploy`? | [`durable-habitat.ts`](../../packages/habitat/src/durable/durable-habitat.ts), [`spec-extract`](../../.agents/skills/spec-extract/SKILL.md), [`verify-deploy`](../../.agents/skills/verify-deploy/SKILL.md) | Builder + Verification Gate UI | [09-dynamic-agent-to-production.md](./09-dynamic-agent-to-production.md) |

---

## How to Run & Test Any Lab Prompt Safely

1. **Isolate in a prototype branch or worktree** (or keep lab builds inside an ignored sandbox folder like `examples/lab-01-*` while iterating):

```zsh
git checkout -b prototype/lab-01
```

2. **Check baseline workspace health** before giving an agent a prompt:

```zsh
pnpm install --frozen-lockfile
pnpm run specs:check
```

3. **Always verify offline mock mode first, then `--live`:**
   - Every prompt asks the agent to build on `fauxProvider` from `@earendil-works/pi-ai` by default so you can iterate in milliseconds with zero API cost.
   - Once the UI, auth boundary, or protocol trace matches the wireframe, switch `--live --model <provider:model>` (e.g. `google:gemini-4-hydrogen` or `ollama:qwen4:32b`).
4. **Operational & Security Conventions** (see [`docs/INDEX.md`](../../docs/INDEX.md)):
   - Bind HTTP prototypes strictly to `127.0.0.1` (avoid `0.0.0.0`).
   - Reserve `74xx` (`7430` `HabitatHost`, `7438` `Mycel`, `7440` coding workbench) or pass port `0` / explicit lab ports (`7451`–`7459`).
   - Keep SQLite/config scratch state in temp directories (`mkdtemp`) or ignored `.umwelten/` paths; never commit credentials.
   - Use `pnpm` / `pnpm exec` / `pnpm dlx` consistently.
5. **Graduate what works via Lab 09:**
   - When a lab crystallizes into a real agent, follow [09-dynamic-agent-to-production.md](./09-dynamic-agent-to-production.md) to run `spec-extract`, eject a clean standalone package/container, and lock invariants with `verify-deploy`.
