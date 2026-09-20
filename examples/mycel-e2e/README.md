# Mycel demos

## The sealed envelope: upstream decides parameter support

```sh
# Automatic demo + executable regression assertions (about a second).
pnpm exec tsx examples/mycel-e2e/pass-through.ts

# Present it live: press Enter before each of four acts.
pnpm exec tsx examples/mycel-e2e/pass-through.ts --step

# Machine-readable result; failures exit nonzero.
pnpm exec tsx examples/mycel-e2e/pass-through.ts --json
```

No external API keys, network services, or paid calls. This starts the **real
Mycel Exchange** and a **simulated supplier** on ephemeral loopback ports with
an in-memory store, a disposable Application credential, and fake credit. All
servers close when the demo finishes. Answers are deliberately deterministic;
this tests gateway behavior, not an LLM's intelligence or schema compliance.

### The reveal

The catalog advertises only `chat`. The request contains a JSON schema for
routing a refund ticket plus an unknown provider-specific extension. A short
SHA-256 fingerprint makes the unchanged request visible; assertions compare
the full parsed payload, not just its fingerprint.

| Act | Change | HTTP | New upstream calls | What it proves |
| --- | --- | --- | --- | --- |
| 1 | Upstream accepts the schema | 200 | 1 | Missing catalog flags do not block parameters; typed answer arrives and one debit is recorded |
| 2 | Flip **only** upstream behavior | 400 | 1 | Identical request and catalog, different upstream decision; rejection status and error details survive |
| 3 | Add explicit `X-Exchange-Require-Capability` | 503 | 0 | A caller-requested routing constraint is still enforced |
| 4 | Supply an invalid Application credential | 401 | 0 | Pass-through does not bypass authentication |

Presenter prompt before act 2: **“Same model, same catalog, same envelope. Who
should decide whether this works?”** Before act 3: **“What if I explicitly ask
the router to restrict my options?”**

The demo asserts that the catalog never changes. Restoring the old
payload-derived capability gate makes act 1 fail rather than printing a false
success. Dropping fields breaks the full-payload check; hiding supplier errors,
ignoring explicit constraints, or bypassing authentication breaks later acts.
The supplier's rejection is exposed through Mycel's existing `upstream_error`
envelope, not claimed to be a byte-for-byte HTTP error passthrough.

This demo does not alter production, test live providers, or assert production
throughput/cost. Its real-provider counterpart is the three-case Mycel smoke
documented in [the Jev pilot report](../../reports/2026-09-20-jev-development-pilot.md).

## Existing full-path example

```sh
pnpm exec tsx examples/mycel-e2e/run.ts
```

The older example demonstrates Interaction → Mycel → mock supplier, JWT and
static-credential authentication, metering, and balances.
