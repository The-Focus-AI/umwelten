# T8: Standards Broadcast Tool (A2A Audit Trigger)

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

A Gaia tool that sends an A2A message to one or all running habitats telling them to pull the latest standards and run a self-audit. Uses the existing A2A infrastructure (`sendA2AMessage`, `discoverHabitats`) with A2A's blocking send-message mode (`return_immediately: false`) to wait for each habitat's structured findings response.

**New Gaia tool `broadcast_standards`:**
Takes an optional `habitatId` parameter. If provided, audits only that habitat. If omitted, audits all running habitats that have a standards agent.

For each target habitat:
1. Sends an A2A message: "Pull the latest standards from the standards agent at `/data/agents/standards/repo`. Review the current best-practices against this habitat's own project and configuration. Return a structured findings report with: compliant items, non-compliant items with severity, and suggested remediations."
2. Waits for the response (blocking send, `return_immediately: false`).
3. Collects and summarizes findings.

Returns a summary across all habitats: which passed, which have findings, and per-habitat detail.

**Habitat-side:** The habitat receives the A2A message through the existing `HabitatAgentExecutor` / `ChannelBridge`. It uses its own LLM + tools (file ops, bash, ripgrep) to pull the standards repo and audit. No new habitat-side code is needed — the LLM handles this with existing tools.

## Acceptance criteria

- [ ] `broadcast_standards` Gaia tool exists and is callable via Gaia chat/MCP
- [ ] Calling with a specific `habitatId` audits only that habitat
- [ ] Calling without `habitatId` audits all running habitats with a standards agent
- [ ] Tool uses A2A blocking send-message (waits for response)
- [ ] Response includes per-habitat findings: compliant items, non-compliant items with severity
- [ ] Habitats without a standards agent are skipped with a warning
- [ ] Non-running habitats are skipped with a warning
- [ ] Timeout handling: if a habitat doesn't respond within N seconds, report as "unresponsive"
- [ ] Integration test: create habitat with standards agent, trigger broadcast, verify structured response

## Blocked by

- T7 (standards agent must be auto-seeded on habitats for there to be anything to audit)
