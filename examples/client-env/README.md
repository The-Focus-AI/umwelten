# Client Environment Prototype (`GaiaHost` Perimeter + Zero-Secret Runtime)

Runnable two-plane reference architecture (see Decision `D-11` and [`durable-habitats.md`](../../docs/specs/orchestration/durable-habitats.md)):

1. **Trusted Perimeter Gateway** ([`perimeter.ts`](./perimeter.ts)):
   - Holds all upstream secrets (QuickBooks OAuth token, Mycel application credential) cleanly inside the gateway vault.
   - Runs a **dedicated client-local Mycel Exchange** metering tokens in integer micro-dollars and acting as the LLM proxy (`/llm/v1/*`).
   - Enforces a **Hybrid HTTP/MCP Egress Proxy** (`/egress/:service/*` method/path ACLs + secret scrubber, plus `/forward-check` host allowlist gate).
   - Writes one correlated **Audit & Trace Ledger** (`traces.jsonl`) keyed by `(traceId, habitatId, speakerId)` and streams spans live to the Warm Paper UI.
2. **Untrusted Zero-Secret `HabitatRuntime`** ([`runtime.ts`](./runtime.ts)):
   - Runs `DurableHabitat` (`node:sqlite` + Mounted read-only `GLOSSARY.md` ontology) holding **zero** Intuit or LLM secrets.

## Recipes

Run the full automated verification suite (`401` gate, `403` DELETE ACL, secret scrubbing, forward allowlist, 2-turn Mycel + QuickBooks trace correlation):

```zsh
pnpm run demo:client-env -- --smoke
```

Start the live Warm Paper Audit & Trace Workbench (`http://127.0.0.1:7450`):

```zsh
pnpm run demo:client-env -- --serve
```
