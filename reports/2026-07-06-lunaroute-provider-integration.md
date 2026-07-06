# Adding LunaRoute as an umwelten provider

Research report, 2026-07-06 (rev 2 — first draft wrongly researched `erans/lunaroute`, an unrelated local proxy with the same name).

> **Status: implemented and verified 2026-07-06.** Provider at `packages/core/src/providers/lunaroute.ts`, registered in `providers/index.ts` (`LUNAROUTE_API_KEY`, optional `LUNAROUTE_BASE_URL`), listed in `getAllModels()`. Gaia: `LUNAROUTE_API_KEY` added to fnox `FALLBACK_SECRET_NAMES` + fnox.toml template; container attach-inference derives the env name from the provider automatically.
>
> **Corrections found during verification:**
> - The inference gateway is **`https://gw.lunaroute.com/v1`** — not `api.lunaroute.com` (that host serves the app API and rejects inference keys with `Invalid or expired token`) and not the `api.lunaroute.ai` printed in the site copy (does not resolve).
> - Served model IDs carry **variant suffixes**: `glm-5.2-nvfp4`, `glm-5.2-nvfp4-ballast` — not the bare `glm-5.2` from the marketing page. Pricing fallback matches by prefix.
> - `/v1/models` **does work** on the gateway and returns rich metadata (context_length 1M, max_output 131072, capabilities incl. `tools`, `reasoning`, `json_schema`, `anthropic_messages`) but **no pricing** — the published table remains the cost source.
>
> Verified end-to-end: `models --provider lunaroute` lists both variants with pricing; `run -p lunaroute -m glm-5.2-nvfp4` streams a response with correct cost math ($0.003151 for 61/458 tokens — note glm-5.2 emits reasoning tokens, so completion counts run high); all 6 integration tests pass (`vitest run --config vitest.integration.config.ts …/lunaroute.integration.test.ts`).

## What LunaRoute is

[LunaRoute](https://lunaroute.com) is a **hosted, OpenAI-compatible inference router** for open-weight frontier models — single endpoint, automatic failover, latency-based routing. Same product category as OpenRouter, and the integration is the same shape as our `openrouter` provider: Bearer key + OpenAI-compatible API.

| Thing | Value |
| --- | --- |
| Base URL | `https://api.lunaroute.com/v1` — **verified live**. The site's copy says `api.lunaroute.ai`, but that host does not resolve (checked 2026-07-06); `.com` answers correctly. |
| Auth | `Authorization: Bearer $LUNAROUTE_API_KEY` (keys from https://app.lunaroute.com → dashboard → keys) |
| Chat | `POST /v1/chat/completions` (OpenAI format) |
| Models | `GET /v1/models` **exists** — returns 401 `{"error":"Authorization header required"}` without a key, so listing is live-enumerable with auth |
| Model IDs | Bare names, no namespace prefix: `glm-5.2`, `kimi-k2.7`, `qwen-3.7-plus`, `minimax-m3`, `deepseek-v4-pro` |
| Billing | Monthly credit plans ($10–$200), balances roll over; metered per token |
| Data | "Request bodies stored: never, nowhere" — processed in memory only; US-based upstream providers |

Published pricing (per 1M tokens, as of 2026-07-06):

| Model | Context | Input | Output |
| --- | --- | --- | --- |
| glm-5.2 | 200K | $2.10 | $6.60 |
| kimi-k2.7 | 256K | $1.50 | $6.00 |
| qwen-3.7-plus | 128K | $0.40 | $1.60 |
| minimax-m3 | 1M | $0.45 | $1.80 |
| deepseek-v4-pro | 164K | $2.61 | $5.22 |

## Integration: mirror the openrouter provider

This is the simplest provider class we have — keyed, OpenAI-compatible, live model listing. No new dependencies: `@ai-sdk/openai-compatible` is already in core (llamaswap/lmstudio use it).

### `packages/core/src/providers/lunaroute.ts`

```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base.js";
import type { ModelDetails, ModelRoute } from "../cognition/types.js";

const BASE_URL = "https://api.lunaroute.com/v1";

// Published pricing per 1M tokens — fallback in case /v1/models omits pricing.
// Verify against the live /v1/models response once a key is available.
const PRICING: Record<string, { promptTokens: number; completionTokens: number }> = {
  "glm-5.2": { promptTokens: 2.1, completionTokens: 6.6 },
  "kimi-k2.7": { promptTokens: 1.5, completionTokens: 6.0 },
  "qwen-3.7-plus": { promptTokens: 0.4, completionTokens: 1.6 },
  "minimax-m3": { promptTokens: 0.45, completionTokens: 1.8 },
  "deepseek-v4-pro": { promptTokens: 2.61, completionTokens: 5.22 },
};

export class LunaRouteProvider extends BaseProvider {
  constructor(apiKey: string) {
    super(apiKey, BASE_URL);
    this.validateConfig();
  }

  async listModels(): Promise<ModelDetails[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.data)) {
      throw new Error(`LunaRoute API error: ${data?.error || response.statusText}`);
    }
    return data.data.map((model: any) => ({
      provider: "lunaroute",
      name: model.id,
      contextLength: model.context_length,
      costs: PRICING[model.id] ?? { promptTokens: 0, completionTokens: 0 },
      // If /v1/models returns pricing fields, map them here instead of PRICING
    } as ModelDetails));
  }

  getLanguageModel(route: ModelRoute): LanguageModel {
    this.validateConfig();
    const lunaroute = createOpenAICompatible({
      name: "lunaroute",
      baseURL: this.baseUrl!,
      apiKey: this.apiKey,
      includeUsage: true, // usage in streamed responses → cost tracking works
    });
    return lunaroute(route.name);
  }
}

export function createLunaRouteProvider(apiKey: string): LunaRouteProvider {
  return new LunaRouteProvider(apiKey);
}

export function getLunaRouteModelUrl(_modelId: string): string {
  return "https://lunaroute.com"; // no per-model pages found yet
}
```

### Registration — `providers/index.ts`

```typescript
registerProvider("lunaroute", {
  create: (key) => createLunaRouteProvider(key!),
  envVar: "LUNAROUTE_API_KEY",
  getModelUrl: getLunaRouteModelUrl,
});
```

The registry handles the missing-key error path automatically (`getModelProvider` throws `LUNAROUTE_API_KEY environment variable is required`).

### Files to touch

| File | Change |
| --- | --- |
| `packages/core/src/providers/lunaroute.ts` | New provider (above) |
| `packages/core/src/providers/index.ts` | Import + `registerProvider("lunaroute", …)` |
| `packages/core/src/cognition/models.ts` | Add to `getAllModels()`, gated on `process.env.LUNAROUTE_API_KEY` like the other keyed providers |
| `packages/core/src/providers/lunaroute.integration.test.ts` | Gated on `LUNAROUTE_API_KEY`: listModels shape, one cheap `generateText` (`qwen-3.7-plus` is the cheapest), streaming usage present |
| `.env` | Add `LUNAROUTE_API_KEY=…` |
| `CLAUDE.md` / `LLM.txt` | Providers list + env var section |

No runner/request-option defaults touched — no HARD RULES in play.

### Usage after implementation

```bash
dotenvx run -- pnpm run cli models --provider lunaroute
dotenvx run -- pnpm run cli run -p lunaroute -m glm-5.2 --prompt "Hello"
```

## To verify with a live key (blocked on `LUNAROUTE_API_KEY` in `.env`)

1. **`/v1/models` response shape** — field names (`context_length`? pricing included?). If pricing comes back in the payload, drop the static `PRICING` table and map it like openrouter does.
2. **Streaming** — confirm SSE + `include_usage` works (`includeUsage: true` sends `stream_options`); if the backend rejects `stream_options`, drop the flag and rely on non-streamed usage.
3. **Tool calling** — umwelten's habitat/eval paths depend on it; run one tool-loop smoke test (e.g. `tools demo`) against `glm-5.2`.
4. **Base URL** — re-confirm `.com` vs `.ai` at implementation time; site copy and DNS currently disagree (`.ai` doesn't resolve, `.com` verified).

## Sources

- https://lunaroute.com / https://www.lunaroute.com (product page: models, pricing, curl example, credit plans)
- `curl https://api.lunaroute.com/v1/models` → 401 `{"error":"Authorization header required"}` (endpoint exists; `.ai` host does not resolve)
- https://app.lunaroute.com (dashboard/keys)

**Name collision note:** [erans/lunaroute](https://github.com/erans/lunaroute) on GitHub is an unrelated local Rust proxy for AI coding assistants — not this service.
