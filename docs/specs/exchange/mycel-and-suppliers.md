---
kind: spec
id: mycel-and-suppliers
title: Mycel Token Exchange and Dial-In Supplier Agent
layer: exchange
version: 1
uses:
  - standards/per-speaker-agent-identity@1
---

## Intent

Operate a closed-membership token Exchange (`@umwelten/mycel`) that buys inference wholesale from commercial Vendors and outbound dial-in GPU Suppliers (`@umwelten/supplier`) and resells it retail over an OpenAI-compatible HTTP surface metered in integer micro-dollars.

## Invariants

- **[hard-guarantee-and-capability-filtering]** (*NEVER*): Exchange dispatch **NEVER** routes a request to an Offer lacking a caller-required `Guarantee` or `Capability`, regardless of price or latency rank.
- **[integer-micro-dollar-boundary-metering]** (*NEVER*): Balances, prices, costs, and charges **NEVER** use floating-point dollars (`$1.00 = 1_000_000` micro-dollars), and the Exchange meters prompt admission and streamed completion chunks at its own boundary rather than trusting upstream `usage`.
- **[acyclic-exchange-boundary]** (*NEVER*): `@umwelten/pi` and `@umwelten/supplier` **NEVER** import `@umwelten/mycel` (preventing DAG cycles and keeping Postgres drivers off GPU supplier hosts).

## Acceptance Criteria

- **[supplier-dial-in-liveness]**: `@umwelten/supplier` probes local serving paths (`chat`, `streaming`, `tool-calling`, `structured-output`, multi-concurrency `headroom`) and holds an outbound `WSS /suppliers/connect` connection whose presence defines availability and whose disconnect immediately withdraws the machine's Offers.
- **[mid-stream-balance-enforcement]**: When an End User or Application exhausts its prepaid balance or postpaid credit limit mid-generation, the Exchange cancels the upstream Supplier request and records prompt plus relayed completion charges accurately.

## Implementation Notes

- **Container bundle isolation**: `@umwelten/mycel` builds into a standalone `dist/mycel.js` ESM bundle with a `createRequire` banner so `ws` runs cleanly in a minimal Node container without `node_modules`.

## Verification

1. **Exchange, Store Conformance & Supplier Suite**: Run `pnpm exec vitest run packages/mycel/ packages/supplier/` and `node packages/mycel/dist/mycel.js --help` after `pnpm -r build`.
