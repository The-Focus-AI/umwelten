---
kind: standard
id: per-speaker-agent-identity
title: Per-Speaker Identity Across Agent Protocols and Token Exchange
source: https://standards.thefocus.ai/packs/per-speaker-agent-identity.md
version: 1
status: in_force
---

## Intent

Carry one verified human or service speaker identity from inbound room/protocol requests through tool execution and outbound token-exchange attribution without collapsing multi-user traffic onto a shared operator credential.

## Invariants

- **[signed-speaker-grant]** (*NEVER*): Multi-user A2A and MCP endpoints **NEVER** execute user-scoped tools or reuse another speaker's private conversation without authenticating the caller and isolating state by `(tenant, userId)`.
- **[end-user-exchange-attribution]** (*NEVER*): Outbound inference calls to the Mycel Exchange **NEVER** omit `X-Mycel-End-User`, ensuring every metered prompt and completion is attributed to a stable End User or Habitat identity.

## Verification

1. **Exchange Attribution & Protocol Auth Tests**: Run `pnpm exec vitest run packages/core/src/providers/mycel.test.ts packages/pi/src/extension.test.ts packages/habitat/src/durable/durable-habitat.test.ts` to verify `X-Mycel-End-User` header propagation, unauthenticated non-loopback rejection, and per-identity conversation isolation.
