# 0005 — Rich UI resources over the habitat surface (MCP-UI over A2A + MCP)

Status: **Accepted — not yet implemented**
Date: 2026-06-23

> This ADR was pinned down in a grilling session. All nine decisions below are
> locked. Nothing here is implemented yet — the **Implementation sequencing**
> section is the build order.

## Context

The Focus A2A-agent standard (`standards/best-practices/a2a-agent.md`) makes
*renderable UI* a first-class tool output: every "visual tool" returns a
`ui: createUIResource(...)` alongside its `text`/`json`/`citation`, an MCP-UI
`AppRenderer` renders it client-side, and a dedicated `POST /api/mcp` route exists
**solely** so the renderer's sandboxed iframe can forward UI actions
(`tools/call`, `resources/read`) back into the tool surface (standard §4.1, §7).

We have **two serving surfaces**, and the standard only describes one of them:

- **umwelten container** (`packages/habitat`) — serves A2A at `/a2a`, MCP at `/mcp`
  (`mcp-local-server.ts`, SDK 1.29.0 — the version the standard pins), a vanilla-JS
  web UI (`public/index.html`), and is reverse-proxied by Gaia (`tools/gaia/proxy.ts`,
  pure pass-through).
- **habitats SaaS** (Vercel/Next/Neon/Clerk) — *is* the standard's shape, but dispatches
  agents **primarily over A2A** (`src/workflows/agents/umwelten.ts`); its chat renderer is
  `EmbeddableWorkstream.tsx`.

Current state on both: **no renderable UI exists.** MCP tool results are text-only
(`mcp-tool-bridge.ts` → `{ content: [{ type: "text", text }] }`); A2A parts are
text/file/data; there is no `createUIResource`, no `AppRenderer`, and no `@mcp-ui/*`
dependency in either repo. The MCP SDK already supports `EmbeddedResource`, so the
server-side emission is an unblock, not a rewrite.

### What the grilling established about transport (correction to a first framing)

A2A is **not** UI-incapable. The split is:

- **Display** of a `ui://…` resource (raw HTML, external-URL pointer, or remote-DOM)
  is just bytes — it rides an A2A `DataPart`/`FilePart`. The standard anticipates this:
  the AgentCard advertises `text/html+mcp` in `defaultOutputModes`, and output modes
  *are* A2A parts. habitats' `stream.ts` already has an `artifact` intent to carry it.
- **UI actions**: of MCP-UI's five action types, **four** map onto A2A with no MCP:
  `prompt` and `intent` → a new `message/send`; `link` and `notify` → host-local.
  **Only `tool`** (synchronous tool call that mutates the widget in place, no
  conversational turn) and lazy `resources/read` need `tools/call`, which A2A's
  `message/send`+`message/stream` surface does not expose. That single case is the
  entire reason the separate MCP route exists.

### The artifact-URL defect (a hard dependency for rich responses)

Artifact URLs are minted **relative** (`tools/artifact-tools.ts:160` →
`/files/artifacts/<file>`) and shipped verbatim as the A2A `FilePart.uri`
(`a2a-handler.ts:318`). The AgentCard got a public-origin fix (#170,
`getPublicBaseUrl` / `X-Forwarded-*`), but **artifacts did not**. The habitats SaaS
consumes the uri with no base-join (`stream.ts:266`). Net: artifacts resolve only on
the container's own origin; they 404 in the SaaS chat and through Gaia's proxied SPA.
A "rich response" is precisely a UI resource that references assets by URL, so this
defect blocks the goal.

Serving itself is correct: `/files/*` is sandboxed-served (`container-server.ts:776`)
and Gaia proxies `/api/habitats/:id/files/*` → `/files/*` (`tools/gaia/routes.ts:121`).
The bug is URL *minting*, not URL *serving*.

## Decision (locked)

1. **Transport-agnostic emit.** A tool/agent emits **one** UI resource. The habitat
   **runtime** — not the tool author — selects the transport. "Pass in the resource
   and it works."
2. **Both transports, MCP only when needed.** Display + `prompt`/`intent`/`link`/`notify`
   actions travel over **A2A**. The MCP channel + sandbox-proxy is engaged **only** when
   a resource declares interactive `tool` (or `resources/read`) callbacks.
3. **Rich client responses are a v1 goal**, not deferred.
4. **Absolute-public asset URLs at emit time.** Artifacts (and any asset a UI resource
   references) are minted as absolute URLs against the agent's **public** origin
   (`getPublicBaseUrl`), resolved when the artifact is published. The public origin is
   **threaded into the agent run context** so the publish path (which runs mid-stream,
   `a2a-handler.ts:225`, without the inbound `req`) can build them. Relative-plus-consumer-
   base-join was rejected: a sandboxed mcp-ui iframe has no way to know the agent origin,
   so it cannot base-join, which would silently break the interactive case (4) targets.
5. **A new exposure surface on the habitat side is in scope** (shape TBD — see open
   questions). We are not constrained to bolt UI onto the existing routes.
6. **Interactive callbacks reuse ADR 0003 identity (option i).** The iframe's `tools/call`
   travels over `/mcp`, which is already gated and already being upgraded to per-user JWT
   by the 0003 rollout. The SaaS renderer mints the per-user, habitat-scoped JWT
   (`sub` = viewing user) for the iframe's MCP connection and **holds it as the proxy
   parent**; the token never enters the sandboxed iframe (the iframe `postMessage`s its
   call up, the parent makes the authenticated fetch). No new auth mechanism — one
   identity model (ADR 0003) across A2A and the MCP callback. The v1-restriction
   alternative (widgets touching user-scoped data must round-trip through an A2A turn)
   was rejected as a temporary cap we'd remove anyway.

7. **Content modality: rawHtml + externalUrl in v1; remoteDom deferred.** Both v1
   modalities are a sandboxed iframe (`srcdoc` for rawHtml, `src` for externalUrl); the
   sandbox is the trust boundary. externalUrl rides Decision 4 (absolute-public URLs).
   remoteDom (host-native components via a remote-DOM bridge) is deferred — it needs the
   host to ship a renderer + component vocabulary, with no v1 payoff.
8. **Renderer scope: SaaS `EmbeddableWorkstream` only in v1.** It gets the full mcp-ui
   `AppRenderer` + the Decision-6 proxy. The container's vanilla-JS `public/index.html`
   and the Gaia dashboard are dev/admin surfaces, out of v1 (display-only at most).
9. **Interactive callbacks carry identity only — one token, no new key (supersedes the
   earlier "context-bound, habitat-minted token" design).** A `tool` callback's sole hard
   requirement is "run as the right user," so per-user connectors resolve for the *viewer*
   and one tenant can't read another's. That is exactly what the **ADR 0003 per-user JWT —
   already verified on `/mcp`** — provides.

   - **Mechanism:** the SaaS-as-proxy (Decision 6) attaches the per-user JWT (`sub` = viewer)
     to the `tools/call`. The habitat verifies the JWT it already verifies and **threads the
     `sub` into MCP tool execution** via the existing `runWithSpeaker` / `getSpeaker`
     mechanism (`identity/agent-speaker-context.ts`) — identical to how the A2A executor
     scopes a turn. Nothing else.
   - **No separate context-binding token, no 4th signing key, no minting, no
     stamp-and-echo contract.** The earlier design had the *habitat* mint a
     `{ habitatId, contextId, allowedTools }` token — but ADR 0003 establishes that the
     **SaaS owns the `contextId`** (it mints the thread), so a habitat-minted context token
     was both redundant and inconsistent. If session/thread binding is ever needed, the
     SaaS adds a `contextId` claim to the JWT it already signs — still one token, still one
     key.
   - **Why scope (`allowedTools`) is not a v1 security boundary:** any holder of a valid
     per-user JWT can already call any habitat tool over `/mcp` today. Restricting a widget
     callback to a tool subset is defense-in-depth, not a new boundary, so it is deferred.

   **Deferred to a follow-up (only when a thread-*mutating* widget exists):** session
   rehydration by `contextId` (for a widget that writes to the originating thread's state,
   vs. a pure per-user fetch like "refresh my bookmarks") and per-resource tool scoping.
   Both are additive over this identity-only base and need no redesign.

## Implementation sequencing

1. **Fix artifact URLs (Decision 4).** Thread the public origin (`getPublicBaseUrl`) into
   the run context; mint absolute-public URLs in `artifact-tools.ts` / `metaToA2AArtifact`.
   Also base-join on the consumer side (`habitats stream.ts:266`) as belt-and-suspenders.
   *This is independently shippable and unblocks every later step.*
2. **Server emit (Decision 1, 2, 7).** Add `@mcp-ui/server`; let a tool return a
   `createUIResource` (rawHtml/externalUrl). Carry it as an A2A part (display path) — no
   MCP callback yet. Unblock `mcp-tool-bridge.ts` to pass `EmbeddedResource` through.
3. **SaaS render (Decision 8).** Add `@mcp-ui/client` `AppRenderer` to
   `EmbeddableWorkstream`; render display resources; wire `prompt`/`intent`/`link`/`notify`
   to the existing `send()`. *Now rich, non-interactive UI works end to end over pure A2A.*
4. **Interactive callbacks (Decision 6, 9).** Thread the JWT `sub` already verified on
   `/mcp` into MCP tool execution via `runWithSpeaker`, so a widget's `tool` call resolves
   per-user connectors as the viewer. The SaaS-as-proxy attaches the per-user JWT to the
   `tools/call`. No token minting, no new key, no session rehydration. *Prerequisite (the
   0003 JWT verifier reaching `/mcp`) is already met — `/mcp` runs `auth.authenticate(req)`
   with `compositeAuth("jwt+bearer", …)`.*

## Hardening / refinements (not blockers)

- `runWithSpeaker` is the existing A2A identity primitive; the only gap is that
  `/mcp` authenticates the connection but does not yet thread the user into tool execution.
- Audit-log per-user `tools/call`s the same way ADR 0003 wants per-user attribution.
- Deferred (Decision 9): session rehydration by `contextId` and per-resource tool scoping,
  if/when a thread-mutating widget needs them.

## Glossary

- **UI resource** — a renderable artifact a tool emits via `createUIResource`, addressed
  `ui://…`, in one of three modalities (rawHtml / externalUrl / remoteDom). v1 ships the
  first two (Decision 7).
- **AppRenderer** — the mcp-ui client component that renders a UI resource in a sandboxed
  iframe and brokers its actions. In v1 it lives only in the SaaS `EmbeddableWorkstream`
  (Decision 8).
- **UI action** — a message a rendered widget sends to its host: `prompt`, `intent`,
  `link`, `notify` (all satisfiable over A2A), or `tool` / `resources/read` (the only ones
  needing the MCP callback channel).
- **SaaS-as-proxy** — the renderer's parent holds the per-user JWT and makes the
  authenticated `/mcp` call on the sandboxed iframe's behalf; the token never enters the
  iframe (Decision 6).
- **`runWithSpeaker` / `getSpeaker`** — the existing AsyncLocalStorage identity primitive
  (`identity/agent-speaker-context.ts`) that scopes a run to a user. Interactive callbacks
  reuse it to run a widget's `tool` call as the JWT `sub` (Decision 9) — no separate token.

## References

- Standard: `standards/best-practices/a2a-agent.md` §4.1, §7.
- Builds on: ADR 0003 (per-user A2A identity) — the basis for Q3.
- Code touchpoints: `packages/habitat/src/mcp-tool-bridge.ts`,
  `a2a-handler.ts` (`metaToA2AArtifact`, `:225`, `:318`), `tools/artifact-tools.ts:160`,
  `container-server.ts` (`getPublicBaseUrl`, `:776`), `tools/gaia/routes.ts:121`;
  habitats `src/lib/a2a/stream.ts:266`, `src/lib/embed/EmbeddableWorkstream.tsx`.
