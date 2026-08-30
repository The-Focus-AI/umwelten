# 0032 — Components project onto the wire as UI resources

Status: **Accepted — partially implemented**
Date: 2026-08-23

Implementation note (2026-08-29): persistent Shell Components are published
as `ui://shell/...` MCP resources and mounted through solo-page URL projections.
One-shot mcp-ui resources continue to project over A2A and MCP. They do not yet
share one canonical internal representation, and the attenuated action binding
(`prompt`, `intent`, `tool`, `link`, `notify`) is not implemented.

> Pinned in the same grilling session as ADR 0031 — interfaces and internals
> compose on the substrate.

Substrate components and the existing A2A/mcp-ui machinery (ADR 0005 — UI
resources over A2A and MCP) are one system, normalized the same way ADR 0018
normalized tasks: **one internal model, projected onto both protocols.**

- Within one runtime, composition is the substrate: components, services,
  effects.
- Across a boundary, the unit of interchange is the `ui://` resource,
  unchanged from ADR 0005: one canonical emit shape, projected onto A2A as a
  `text/html+mcp` DataPart and onto MCP as an EmbeddedResource. One-shot tool
  outputs keep riding exactly as built.
- A habitat's persistent components are published as **MCP resources**
  (`resources/list`/`read` in the `ui://` namespace), so a peer discovers and
  fetches them over plain MCP — mcp-ui's native home, and standards-compatible
  with any MCP client.
- **Mounting is the inverse projection**: a received resource mounts as a
  component in an isolated subtree, and mcp-ui's action vocabulary binds to
  substrate services — `prompt`/`intent` to the conversation service, `tool`
  to tool invocation, `link`/`notify` to host services.

The glossary sentence: *a Component lives on the substrate; a UI Resource is
a Component projected onto the wire; mounting is the inverse projection.*

Consequence accepted knowingly: a component that crosses a boundary is
constrained to the action vocabulary. That is the attenuated channel a
foreign component should be limited to (ADR 0033 — the trust line is the
habitat boundary), so the constraint is the design, not a defect.
