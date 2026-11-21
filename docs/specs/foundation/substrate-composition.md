---
kind: spec
id: substrate-composition
title: Substrate Component Lifecycle, Web Shell, and UI Resources
layer: foundation
version: 1
---

## Intent

Host live browser interfaces and cross-agent UI widgets on an isomorphic, zero-dependency composition runtime (`@umwelten/substrate`) where every panel is a revertible component and untrusted peer views stay isolated behind sandboxed `ui://` iframes.

## Invariants

- **[zero-dependency-substrate]** (*NEVER*): `@umwelten/substrate` **NEVER** adds runtime npm dependencies or uses `innerHTML` to render untrusted model or tool markdown text.
- **[foreign-component-sandbox]** (*NEVER*): Foreign peer components **NEVER** mount into the host DOM directly; they mount inside a sandboxed `<iframe>` and communicate exclusively via `postMessage` beacons verified against `iframe.contentWindow`.

## Acceptance Criteria

- **[transactional-component-lifecycle]**: Components activate only when all declared `Service` keys are provided, revert their registered cleanup effects when deactivated or unloaded, and hot-reload updated custom `/shell/custom/*.js` modules without a full page refresh.
- **[dual-transport-ui-projection]**: Publishing a `ui://` resource (`rawHtml` or absolutized `externalUrl`) produces one canonical `HabitatUIResource` that projects identically as an A2A `DataPart` (`outputMode: "text/html+mcp"`) and an MCP `EmbeddedResource`.

## Implementation Notes

- **URL absolutization**: Relative `externalUrl` and artifact paths must be resolved against the Habitat's public origin at emit time because sandboxed `mcp-ui` iframes have an opaque origin and cannot resolve relative paths.

## Verification

1. **Substrate Component & Isolation Suite**: Run `pnpm exec vitest run packages/substrate/`.
