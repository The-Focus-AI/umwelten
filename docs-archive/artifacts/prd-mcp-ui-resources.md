## Problem Statement

Habitat agents can only answer in text. When a tool produces something that wants to be *seen or interacted with* — a chart, a form, a table of a user's data, a set of choice buttons — the agent has no way to put that in front of a person. Today every tool result is flattened to a text string on the MCP surface, and the A2A surface carries only text/file/data parts with no notion of a renderable widget. A user chatting with an agent in the habitats SaaS gets prose where they wanted a UI.

There is also a latent defect that blocks even the simplest "rich" answer: artifact URLs are minted relative and shipped verbatim, so any image or asset an agent references resolves only on the container's own origin and 404s in the SaaS chat and through the Gaia proxy. Rich responses are exactly the things that travel across that origin boundary, so they break precisely where they're meant to be useful.

## Solution

Let a habitat agent emit a **UI resource** (an mcp-ui `createUIResource`) as a first-class tool/agent output, and render it for the user.

From the agent author's perspective there is one thing to do: emit the UI resource. The habitat runtime — not the author — decides how it travels. Display and simple actions ride the existing A2A stream; only genuinely interactive tool callbacks engage the MCP channel. The SaaS chat renders the resource in a sandboxed frame and brokers its actions back safely.

The result: an agent can answer with a rendered chart, a fillable form, choice buttons that send a follow-up, or a live widget that calls a tool and updates itself in place — and the per-user identity and session guarantees the habitat already enforces continue to hold inside that widget.

This work is specified by ADR 0005 (UI resources over A2A + MCP) and depends on the per-user identity model in ADR 0003.

## User Stories

1. As an agent author, I want to emit a single UI resource from a tool, so that I get a rendered result without choosing or wiring a transport.
2. As an agent author, I want the runtime to pick A2A vs MCP for me, so that I never hand-code protocol plumbing per tool.
3. As an agent author, I want to return rendered HTML (rawHtml), so that I can show a custom-formatted result.
4. As an agent author, I want to return a pointer to a page I host (externalUrl), so that I can surface a fuller app or dashboard inside the chat.
5. As an agent author, I want a tool that references an image or file to produce a URL that works wherever it's rendered, so that my rich answer doesn't break off-origin.
6. As a user chatting with an agent in the SaaS, I want to see a rendered widget instead of a wall of text, so that I can understand the answer faster.
7. As a user, I want to click a button in a widget that sends a follow-up message, so that I can continue the conversation without retyping.
8. As a user, I want a widget to open an external link or notify the app, so that simple interactions feel native.
9. As a user, I want an interactive widget (e.g. "refresh my numbers") to call a tool and update in place, so that I don't need a whole new conversational turn for a small action.
10. As a user in a shared thread, I want a widget I interact with to act as *me*, so that it resolves my data and my connected accounts, not someone else's.
11. As a user, I want a widget that touches my private connected account (e.g. an upstream connector token) to be safe even though I share the thread with others, so that my credentials are never exposed to another participant.
12. As a user, I want to click a widget button long after it was rendered (in scrollback) and still have it work, so that the conversation history stays interactive.
13. As a platform operator, I want interactive callbacks to carry a verifiable user identity, so that per-user attribution and cost tracking still apply to widget-driven tool calls.
14. As a platform operator, I want a widget to be unable to call tools it wasn't authorized to, so that a leaked or replayed token can't escalate.
15. As a platform operator, I want the credential that authorizes a callback to never enter the sandboxed frame, so that untrusted rendered content can't read it.
16. As a platform operator, I want the MCP transport to remain stateless, so that a callback rejoining a session does not force per-connection session state on every caller.
17. As a security reviewer, I want the context-binding token to be inert on its own, so that it is useless without a fresh per-user identity token.
18. As a security reviewer, I want unsigned or expired tokens rejected on the callback path, so that the same guarantees as the A2A path hold for MCP callbacks.
19. As an external MCP client (e.g. a probe or desktop client), I want UI resources to render or degrade gracefully, so that I can consume the same tool catalog.
20. As an agent author, I want display-only UI resources to work over pure A2A with no MCP involvement, so that the common case has the smallest moving-part count.
21. As a maintainer, I want UI emission normalized in one place, so that A2A and MCP representations never drift.
22. As a maintainer, I want the artifact-URL fix to ship independently, so that a current defect is corrected without waiting on the full feature.
23. As a user behind the Gaia proxy, I want artifact and asset URLs to resolve through the proxy, so that rendered content is not broken by the reverse-proxy hop.
24. As an agent author, I do not want to ship a custom web UI just to verify my agent renders UI, so that I can rely on the SaaS renderer or an external client.

## Implementation Decisions

(All trace to ADR 0005; identity traces to ADR 0003.)

- **One canonical emitted UI-resource shape.** A tool/agent emits a single UI resource (an mcp-ui `createUIResource`). A transport-agnostic normalization module maps that one resource into the per-transport representation; authors never select a transport. This normalizer is the single point at which A2A and MCP representations are derived, so they cannot drift.
- **Transport split.** Display of a UI resource and the `prompt` / `intent` / `link` / `notify` actions travel over the existing A2A surface (UI resource carried as a message part; the artifact intent is the carrier). The MCP channel is engaged only for `tool` (and lazy `resources/read`) actions — the only ones A2A's `message/send` + `message/stream` surface cannot express.
- **Content modalities in scope: rawHtml and externalUrl.** Both render as a sandboxed iframe (srcdoc vs src); the sandbox is the trust boundary. remoteDom (host-native components) is deferred.
- **Absolute-public asset URLs at emit time.** Artifacts and any asset a UI resource references are minted as absolute URLs against the agent's public origin, resolved using the same forwarded-origin mechanism the AgentCard already uses. The public origin is threaded into the agent run context so the publish path (which runs mid-stream) can build them. Consumers should also defensively base-join against the AgentCard origin.
- **Renderer: SaaS chat only (v1).** The SaaS chat surface gains the mcp-ui `AppRenderer` and the proxy role. The container's built-in web UI and the Gaia dashboard are not renderers in v1 (display-only at most).
- **Callbacks reuse ADR 0003 identity.** The MCP route is already authenticated and is already being upgraded to per-user JWT by the 0003 rollout. The SaaS renderer mints the per-user, habitat-scoped JWT (subject = the viewing user) for the iframe's MCP connection and holds it as the proxy parent; the iframe posts its action up and the parent makes the authenticated call. The token never enters the sandbox. No new auth mechanism — one identity model across A2A and MCP callbacks.
- **Context-bound callbacks (session rehydration).** Because the MCP transport is stateless but the tool that emitted the widget ran inside an A2A session, a callback must be able to rejoin that session. The habitat stamps each emitted UI resource with a habitat-signed **context-binding token**. On callback the proxy presents two tokens; the habitat verifies both, rehydrates the originating session from the verified context for that one call, and authorizes the tool as the JWT subject. The transport stays stateless — the session is rebuilt on demand from the token, not stored per connection.
- **Context-binding token contract (API contract, not a snippet of code):**
  - Claims: `habitatId`, `contextId`, `allowedTools` (the set the emitting resource may call).
  - Minted and signed by the **habitat** (which owns session lifecycle); identity JWT is minted by the **SaaS** (which owns identity). The two concerns stay split exactly as ADR 0003 splits thread (`contextId`) from speaker (`sub`).
  - Binds to `contextId` only, not a single user — a shared thread has many viewers; per-user authorization comes from the JWT. This is the same trust envelope as posting a message to the thread.
  - May be long-lived (life of the `contextId`, to survive scrollback clicks) because it is inert without a fresh, short-lived per-user JWT.
  - `allowedTools` is enforced at the MCP tool-dispatch boundary.
- **Signing key.** The habitat's context-binding token should use a key separate from the ADR 0003 identity keypair, so compromise/rotation of one does not grant the other.
- **MCP tool-result content.** The MCP tool bridge must stop flattening every result to text and pass an `EmbeddedResource` content block through when a tool emits a UI resource (the MCP SDK already supports this).

## Testing Decisions

A good test here asserts **external behavior at a seam** — what comes out of the emit boundary and what the callback path accepts/rejects — never internal wiring. Two seams, matching existing patterns:

- **Seam 1 — the transport-agnostic UI-resource normalizer (primary, one seam).** A pure in→out unit test: given a canonical emitted UI resource plus a run context carrying the public origin, assert it produces (a) the correct A2A part and (b) the correct MCP `EmbeddedResource`, for both rawHtml and externalUrl, and that referenced artifact/asset URLs are **absolute-public**. This single seam covers emit, modality, and URL minting for both transports. Prior art: the adapter-style assertions in the existing A2A handler tests (executor + in-memory event bus, no HTTP).
- **Seam 2 — the MCP callback auth + session-rehydration boundary (extends an existing seam).** Assert that a `tools/call` presenting a valid per-user JWT and a valid context-binding token runs against the rehydrated session and authorizes as the subject; and that it is rejected on a missing/invalid/expired token or a tool outside `allowedTools`. This extends the existing auth-mode seam where bearer/JWT-mode behavior is already unit-tested (the AgentCard `securitySchemes` / auth tests).

Both seams are unit-level against existing module boundaries. No new HTTP integration seam is introduced; the artifact-URL absolute-minting assertion folds into Seam 1 rather than standing alone.

## Out of Scope

- The SaaS-side `AppRenderer` integration, iframe `postMessage` plumbing, and chat rendering changes — they live in the habitats repo, not this one. This PRD covers the habitat/container/protocol side that the SaaS consumes.
- The remoteDom modality (host-native component rendering).
- Rendering UI resources in the container's built-in web UI and the Gaia dashboard.
- Any change to the ADR 0003 JWT verifier itself — this work consumes it, it does not define it. (It does depend on that verifier reaching the MCP route, which is already part of the 0003 rollout.)
- remoteDom-driven or non-iframe rendering surfaces.

## Further Notes

- **Shippable first step.** The absolute-public artifact-URL fix is a current defect independent of mcp-ui and should land first; it unblocks every later step and is independently valuable.
- **Suggested build order** (from ADR 0005): (1) fix artifact URLs; (2) server-side emit + normalizer carrying a UI resource over A2A display with the MCP bridge passing `EmbeddedResource` through; (3) SaaS render of display resources (habitats repo); (4) interactive callbacks with context-binding + the 0003 JWT on the MCP route.
- **Two corrections captured during design** (recorded in ADR 0005): A2A is not UI-incapable — it carries display plus four of the five action types; only `tool`/`resources/read` need MCP. And the MCP route is not anonymous — it is gated by the same auth as the rest of the surface, open only in keyless local dev.
- This PRD is cross-cutting with the habitats SaaS; the renderer half is tracked separately on that side.
