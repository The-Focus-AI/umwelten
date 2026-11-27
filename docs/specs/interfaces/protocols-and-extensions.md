---
kind: spec
id: protocols-and-extensions
title: A2A, MCP Client/Server, MCP Skills, CLI Bundle, and Installable Pi Extensions
layer: interfaces
version: 2
uses:
  - standards/portable-agent-skills@1
  - standards/per-speaker-agent-identity@1
---

## Intent

Expose Umwelten capabilities through standard network protocols (A2A v1.0, OAuth 2.1 MCP server and MCP client on the official `@modelcontextprotocol/server` / `@modelcontextprotocol/client` SDK 2.x speaking protocol revision `2026-07-28` with the 2025-era fallback, and the MCP Skills extension `io.modelcontextprotocol/skills`), the `umwelten` CLI binary, and an installable `@umwelten/pi` extension package (`pi-package`) that works inside both the `pi` CLI and `pi-durable`.

## Invariants

- **[preserve-mcp-ui-embedded-resources]** (*NEVER*): `RemoteMcpClient` (built on `@modelcontextprotocol/client` 2.x) **NEVER** strips `ui://` `EmbeddedResource` payloads or `_meta` from `callTool` results; UI resources pass through `_uiResources` while concise text goes to the model, and the Habitat bridge (`bridgeMcpClientToExtension`) keeps them in the tool result `details` (`uiResources`) for the host UI, out of the model-facing text.
- **[no-custom-mcp-jsonrpc-client]** (*NEVER*): `@umwelten/protocols` **NEVER** maintains a hand-rolled JSON-RPC MCP client, server, or custom stdio/HTTP transport; MCP clients (`RemoteMcpClient`, `discoverAgentEndpoint`) delegate to the official `@modelcontextprotocol/client` 2.x (`Client`, `StreamableHTTPClientTransport`, `SkillsClient`), and `mcp-serve` delegates to `@modelcontextprotocol/server` 2.x (`McpServer`, `createMcpHandler`) via `@modelcontextprotocol/node` (`toNodeHandler`). `@earendil-works/pi-mcp` is not used for MCP client work.
- **[mcp-skill-identity-is-server-and-uri]** (*NEVER*): The host **NEVER** keys an MCP skill's registry entry, approval, active state, or model-facing address on its `name` or `uri` alone; identity is `(serverLabel, uri)` where `serverLabel` is host-assigned (never the server's self-reported `serverInfo.name`), and a bare name resolves only when unique across every origin including local filesystem skills.
- **[mcp-skill-approval-bound-to-manifest]** (*NEVER*): An MCP skill's content **NEVER** enters model context without a user approval bound to its full `{uri, digest}` manifest (`manifestHash`); any listed or fetched entry with a different set revokes the stored approval and asks again, and every file read is verified (size, digest, and `SKILL.md` frontmatter) against the held entry.
- **[mcp-skill-no-implicit-grants]** (*NEVER*): MCP-served skills **NEVER** widen permissions: `allowed-tools` is recorded and ignored, content is wrapped `<mcp-skill origin="mcp:<label>">` as untrusted, `skill_read` reads only manifest files from the skill's own server, and code-execution tools (`bash`, `codemode`) park on per-call user approval while any MCP skill is active in the conversation.
- **[mcp-skill-state-outside-discovery-paths]** (*NEVER*): MCP skill approvals or cached content are **NEVER** written below a filesystem skill-discovery directory (`.agents/skills`, `.claude/skills`, `.pi/skills`, …), where `skillsFromGit` provisioning installs trusted local skills.
- **[self-contained-published-cli]** (*NEVER*): Building `packages/umwelten` (`pnpm -r build`) **NEVER** leaves unresolved workspace imports or CJS dynamic-require crashes in `dist/cli/entry.js --help`.

## Acceptance Criteria

- **[durable-a2a-v1-endpoint]**: Mounting `DurableHabitat.createA2ASurface()` (`@leocavalcante/pi-a2a/durable`) serves `GET /.well-known/agent-card.json` and `POST /a2a` (`A2A-Version: 1.0`), deduplicating retries by `messageId` and returning committed task artifacts.
- **[mcp-2026-07-28-negotiation]**: `RemoteMcpClient` and `discoverAgentEndpoint` negotiate `2026-07-28` via `server/discover` against an SDK 2.x server (including an authenticated `createMcpServeMount`) and fall back to `initialize` for 2025-era servers; `discoverAgentEndpoint` tags capabilities `mcp-tool`, `mcp-skill`, or `a2a-skill`.
- **[mcp-skills-server-and-host]**: `createMcpServer` / `createMcpServeMount` accept a `SkillsExtension` (`loadSkills(dir)`), and `McpSkillHost` lists skills lazily (no `resources/read` before load), rejects unlisted/size/digest/frontmatter mismatches, and revokes approval on manifest change.
- **[mcp-skills-in-durable-harness]**: `createMcpSkillsExtension` renders a stable `skills` prompt section (name, description, origin), parks `skill_load` on `McpSkillApprovalSignal` keyed by manifest hash, records active skills in `ActiveMcpSkillsDoc` (`fork: "current"`), and gates code-execution tools while a skill is active.
- **[a2a-advertises-served-mcp-skills-only]**: A Habitat's A2A card advertises MCP skills it **serves** as agent skills with `id: "mcp-skill:<SKILL.md uri>"` and tag `mcp-skill` (`createA2ASurface({ servedMcpSkills })`), and never advertises MCP skills it has **loaded** from other servers.
- **[installable-pi-extension-package]**: Loading `@umwelten/pi` into a Pi `ExtensionAPI` host registers `umwelten_session_search`, `umwelten_promote_knowledge`, and `/umwelten-explorations` without duplicating Pi's native provider/`models.json` layer, while `@umwelten/pi/durable` exports the `pi-durable` Harness extensions.

## Implementation Notes

- **A2A version header**: `@a2a-js/sdk` v1.x defaults missing `A2A-Version` HTTP headers to `"0.3"`; callers speaking A2A 1.0 JSON-RPC to `@leocavalcante/pi-a2a/server` must include `A2A-Version: 1.0` (sent automatically by `@a2a-js/sdk` v1.3 `Client`).
- **mcp-serve auth hand-off**: `mcp-serve` validates its own Bearer tokens, then hands the principal to `createMcpHandler`'s per-request factory as `AuthInfo.extra.userId` (the SDK treats `authInfo` as pass-through and never parses headers itself).
- **Client opt-in**: SDK 2.x `Client` defaults to `versionNegotiation: { mode: "legacy" }`; umwelten clients pass `{ mode: "auto" }` to reach `2026-07-28`.
- **A2A skills vs MCP skills**: an A2A agent skill is an advertised capability with no content; an MCP skill is a `SKILL.md` package with a digest manifest. See `packages/protocols/src/mcp/skills/a2a.ts`.
- **Conformance**: `@modelcontextprotocol/conformance` 0.1.16 has 2025-era scenarios only; the applicable ones (`server-initialize`, `ping`, `tools-list`, `resources-list`, `dns-rebinding-protection`) pass against the example skill server, which validates localhost Host/Origin.

## Verification

1. **Protocols, Pi Extension & Published Binary Check**: Run `pnpm exec vitest run packages/protocols/ packages/pi/ packages/cli/` followed by `pnpm -r build && node packages/umwelten/dist/cli/entry.js --help`.
2. **MCP Skills Host & Harness Suite**: Run `pnpm exec vitest run packages/protocols/src/mcp packages/habitat/src/durable/mcp-skills.test.ts`, then `pnpm run demo:mcp-skills` (chat host ↔ skill server end to end) and, with the skill server running on `7701`, `pnpm run demo:mcp-skills:conformance`.
