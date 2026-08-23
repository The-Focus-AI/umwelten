# The habitat surface is a function of its live composition

> Status: design settled in a grilling session, 2026-08-23. The decisions live
> in three ADRs — this document is the frame that connects them and the record
> of what the grilling corrected. Nothing here is implemented yet.
>
> - ADR 0031 — tool registration is revertible, and tool sets declare needs
> - ADR 0032 — external harnesses mount as runtimes, not foundations
> - ADR 0033 — the client discovers the habitat surface

## Where this came from

Two outside artifacts prompted the review:

- **"A Programming Paradigm for Spatiotemporal Composability"**
  (cordiverse/paper, preprint 2026-08-13) — formalizes dynamic composition as
  two guarantees: *temporal* (unloading a component completely reverts its
  effects, because every effect carries its inverse and the runtime composes
  them LIFO) and *spatial* (a component declares what it needs, and the
  runtime activates/deactivates it as those dependencies appear and leave).
  The formalism was extracted from Koishi's plugin system (4000+ community
  plugins); its implementation is the Cordis meta-framework.
- **DeepSeek Harness (dsh)** — an agent harness built on Cordis
  ("everything is a plugin": `ctx.llm`, `ctx.tools`, `ctx.sessions`,
  `ctx.systemPrompt`, `ctx.agents`, `ctx.agentLoop` are all plugins on one
  context). Its six core services and umwelten's module decomposition are the
  same six boxes, arrived at independently — which says the decomposition is
  right, and makes the difference in *composition mechanism* the interesting
  part.

The review's verdict, which these designs implement: **umwelten's static
composition is a defensible choice; its dynamic composition isn't.** The
package DAG is an asset — umwelten is a library, and a plugin tree would cost
its importers plenty. But the four things that genuinely load and unload at
runtime — tools, skills, agents, runtimes — currently do so with no mechanism:
registration is add-only (`remove_custom_tool` deletes the directory while the
live session keeps the tool), availability is ad hoc (three tool sets each
hand-roll their own "inert unless configured" check), and the web client
hardcodes a surface the server may not have.

## The principle

**Make the habitat's surface a function of its live composition, and make
consumers discover it rather than assume it.** Applied at three layers:

| Layer | Mechanism | ADR |
| --- | --- | --- |
| Capability | tool sets register revertibly and declare needs (`inject`); active means satisfied | 0031 |
| Runtime | the agent loop is a declared, swappable component behind the RuntimeRunner seam; external harnesses (dsh, codex) mount there | 0032 |
| Presentation | the client renders what discovery reports — agent card, capabilities, tool-set-contributed panels | 0033 |

What we take from the paper is its *discipline*, not its machinery: teardown
derived from registration (never written separately), activation derived from
declaration (never checked ad hoc). What we deliberately do not take: Cordis
itself, effect contexts, fibers, an event bus, or any restructuring of core.
The paper's own boundary result supports the split we already have — language-
level composition cannot sandbox untrusted code (§6.3), so Gaia's containers
remain the trust boundary and fine-grained composition lives inside them.

## What the grilling corrected

Three first framings broke against the code; the ADRs record the corrected
versions. Kept here because the wrong versions sounded plausible enough to
reappear.

1. **"DSH drops in as one config entry."** Understated. A `parser: "text"`
   mount runs but is degraded — no tool events, no reasoning stream, final
   text smeared across raw stdout. And config-declared CLI runtimes are
   one-shot per message: `buildInvocation` (cli-runner.ts) substitutes only
   `{prompt}`/`{cwd}`; a `nativeSessionRef` is recorded for introspection but
   never resumed — true of codex today too. Mounting a stateful harness well
   needs resume templating and a parser seam first (ADR 0032 D3).
2. **"A capabilities endpoint is the cheap first step."** Not currently
   possible at any price: `Habitat.addToolSet` flattens tools into one map and
   *erases tool-set identity* — nothing in a running habitat can answer
   "which tool sets are active." The ADR 0031 registry restructure is a
   prerequisite of the endpoint, not a parallel track.
3. **"Then panels as UI resources."** The server half of ADR 0005 landed
   (`ui-resources.ts`, `mcp-tool-bridge.ts` emit; the artifact-URL defect is
   fixed — `toAbsoluteArtifactUrl` is applied in both emit paths). The client
   half never did: `public/index.html` has no mcp-ui renderer at all. The
   renderer is the critical path for ADR 0033, before any panel exists.

## Build order across the three ADRs

Capability and presentation are one dependent chain; the runtime track is
independent and can proceed in parallel.

1. ADR 0031: registry keeps tool-set membership + disposers (fixes the live
   `remove_custom_tool` / `reload_tools` bug in the same change).
2. ADR 0031: `inject` on ToolSet; secret-change re-evaluation.
3. ADR 0033: `/api/capabilities` (now a read of the registry).
4. ADR 0033: mcp-ui renderer in the shell client.
5. ADR 0033: panels as tool-set contributions; retire `public/index.html`
   tabs one at a time.
6. ADR 0032 (parallel): resume templating + parser seam in cli-runner; verify
   dsh-headless's output contract; then a `dsh` preset.

## What this does not attempt

- No Cordis adoption, no browser-side plugin runtime (the Koishi-console
  model), no event bus. Rejected explicitly in the ADRs, with reasons.
- No change to Mycel or the supplier agent. The paper's
  acquisition/emission boundary (§6.1) *describes* Mycel's existing design —
  an Offer publish is revertible acquisition, a metered relay is emission
  needing compensation — but describes it as already correct.
- No change to the evaluation, introspection, or knowledge pipelines — the
  review found those are where umwelten is *ahead* of the field, not behind.
