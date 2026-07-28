# Exchange metering spike (E3)

> Can the exchange bill what it sold?

```bash
pnpm tsx examples/exchange-metering/run.ts
```

No API keys, no GPU. `mock-upstream.ts` serves an OpenAI-compatible SSE stream in
three modes, and `LLAMASWAP_HOST` points the **real** runner, provider, and
usage-extraction cascade at it — nothing is stubbed on our side.

| Mode | What it serves | Why it matters |
| --- | --- | --- |
| `usage-in-final-chunk` | tokens, then usage | the happy path |
| `no-usage` | tokens, never usage | real providers do this |
| `never-finishes` | tokens forever | forces the client to hang up |

**Answer: no, not from `ModelResponse.metadata`.** Two of the three produce a
request that looks free while real tokens were served. Findings and the design
consequence are in
[`reports/2026-07-26-can-the-exchange-bill-what-it-sold.md`](../../reports/2026-07-26-can-the-exchange-bill-what-it-sold.md);
the decision is [ADR 0011](../../docs/adr/0011-the-exchange-meters-at-its-own-boundary.md).

Note the deliberate `process.exit(0)` at the end of `run.ts`: the local providers
install a global undici dispatcher whose keep-alive sockets hold the event loop
open, so the process will not exit on its own once one has been touched.
