# 0033 — The client discovers the habitat surface

Status: **Accepted — not yet implemented**
Date: 2026-08-23

> Pinned down in a grilling session. Frame:
> `docs/architecture/composable-surface-2026-08.md`. Depends on ADR 0031 —
> tool registration is revertible, and tool sets declare needs. Builds on
> ADR 0005 — UI resources over A2A and MCP.

## Context

The habitat web client (`packages/habitat/public/index.html`) is 3,184 lines
of hand-written SPA calling a dozen bespoke endpoints — `/api/chat`,
`/api/sessions`, `/api/secrets`, `/api/settings`, `/api/artifacts`,
`/api/knowledge`, `/api/habitats`, `/api/standards-audit` — with every tab
hardcoded. The client *assumes* a composition rather than discovering one:
the secrets tab renders whether or not the secrets tool set is registered,
and adding a capability to the server means hand-editing this file. Gaia's
dashboard is a second hand-maintained SPA with the same disease.

Meanwhile the discovery surface already exists and the client ignores it: the
habitat publishes an A2A agent card and an MCP tools list, and the server
half of ADR 0005 has landed — tools can emit mcp-ui UI resources
(`ui-resources.ts`), they ride A2A as `text/html+mcp` DataParts and MCP as
EmbeddedResources (`mcp-tool-bridge.ts`), and the artifact-URL defect that
ADR 0005 flagged as the hard blocker is fixed (`toAbsoluteArtifactUrl` is
applied on both emit paths).

The grilling established the two facts that order the work:

- **No client-side renderer exists.** `public/index.html` contains no mcp-ui
  `AppRenderer`, no `text/html+mcp` handling — ADR 0005's client half was
  never built in this repo. The renderer, not the panels, is the critical
  path.
- **Capabilities reporting requires ADR 0031.** Tool-set identity is erased
  at registration today; there is nothing for an endpoint to report until the
  registry keeps per-set records.

The precedent (from the spatiotemporal-composability paper's case study) is
Koishi's console: server plugins contribute console pages, so the UI is a
function of the live plugin tree — install a plugin and its panel appears.
We adopt the *outcome* (UI mirrors composition) without the *mechanism*
(a browser-side plugin runtime).

## Decisions

**D1 — One generic shell client; per-habitat UI is discovered.** The shell
is: a chat pane, a discovery pass, and a UI-resource renderer. Everything
else a habitat shows is a contribution the shell discovered, not a tab the
shell shipped with. The 260-line `examples/agent-browser/index.html`
(discovery + chat against any A2A/MCP endpoint) is the shape's existing
proof; `public/index.html` is the anti-pattern being retired. Consequence:
the same shell works against *any* habitat — and degrades gracefully against
any A2A agent that emits UI resources.

**D2 — Discovery is the agent card plus `/api/capabilities`.** The endpoint
is a read of ADR 0031's registry: for each tool set — name, description,
status (`active`/`inactive`), unsatisfied `inject` keys when inactive, and
contributed tool names. The shell renders active sets as available surface
and inactive sets as an honest affordance ("search — inactive, missing
secret:TAVILY_API_KEY" with a link into the secrets panel), which no
hardcoded tab can do: today an unconfigured capability is indistinguishable
from an absent one.

**D3 — The renderer lands first.** The shell embeds an mcp-ui `AppRenderer`
handling raw-HTML and external-URL resources (remote-DOM stays deferred, as
ADR 0005 decided). UI actions follow ADR 0005's split exactly: `prompt` and
`intent` become a new `message/send`; `link` and `notify` are host-local;
only synchronous `tool` actions and lazy `resources/read` use the `/mcp`
route. Nothing in that decision is reopened here.

**D4 — A panel is a tool-set contribution.** A tool set may declare panels:
UI resources with stable `ui://<set>/<panel>` ids, listed in the
capabilities payload and fetched/rendered by the shell. Active set → panel
present; set deactivates (ADR 0031 D5) → panel drops on the next discovery
pass. The panel's actions reach the same tool surface every other client
uses — a panel is a *view over tools*, never a private API. New server
routes for a panel's exclusive use are the smell this ADR exists to prevent.

**D5 — `public/index.html` is retired tab by tab, chat-first shell.** Order:
status and secrets first (they map one-to-one onto existing tool sets and
exercise D2+D4 end to end), then sessions, artifacts, knowledge. Chat stays
shell-native throughout. The bespoke `/api/*` route for a tab is deleted in
the same change that ships its panel — the point is removing the parallel
surface, not adding a second one beside it.

**D6 — Gaia converges on the same shell, later.** Gaia is a habitat whose
orchestrator tool set contributes richer panels (registry, containers,
vault); its dashboard is not a special client. This is the end state, not a
blocking step — nothing in D1–D5 waits on Gaia.

**D7 — Not adopted: the client as a plugin runtime.** Koishi's console is
itself a Cordis application in the browser. Rejected for us: our panels are
few and first-party, and a browser-side plugin runtime is a second framework
to maintain for a benefit (third-party client plugins) nobody has asked for.
Discovery + rendered contributions gets the composability outcome at a
fraction of the machinery.

## Consequences

- Adding a capability to a habitat changes zero client code: the tool set
  ships its tools and its panel, and every shell instance shows it on the
  next discovery pass.
- The client stops lying: what it shows is what the habitat can currently
  do, including *why* something is unavailable.
- One shell serves container habitats, Gaia, and (unchanged) any external
  A2A agent — three hand-maintained UIs collapse toward one.
- The habitats SaaS renderer (`EmbeddableWorkstream.tsx`, per ADR 0005) and
  this shell consume the same emitted resources; server-side work is shared.

## Implementation sequencing

1. `/api/capabilities` (after ADR 0031 steps 1–4).
2. Shell v1: agent-card discovery + capabilities view + chat + AppRenderer
   (grow `examples/agent-browser` into `packages/habitat/public/shell/`).
3. Panel contribution contract on `ToolSet`; status + secrets panels;
   delete their bespoke routes.
4. Remaining tabs in D5 order; retire `public/index.html`.
5. Gaia panels (D6), separately scheduled.
