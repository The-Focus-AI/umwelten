# The substrate: self-assembling interfaces

> Design settled in a grilling session, 2026-08-23. Decisions are recorded in
> ADR 0031 — interfaces and internals compose on the substrate, ADR 0032 —
> components project onto the wire as UI resources, and ADR 0033 — the trust
> line is the habitat boundary. This document is the decision log and the
> staging plan. An earlier, ungrilled draft set at these ADR numbers was
> removed from this branch; nothing from it is binding.

## The vision, in the user's terms

A UI system we can use to assemble other interfaces — specifically ones that
assemble themselves. One base that habitats use; Gaia and Mycel's client
surface built off that same base; and habitats themselves able to build out
their own components. The model is cordiverse's "A Programming Paradigm for
Spatiotemporal Composability" — implemented by us, not imported.

## Decision log

Every verdict below was put as a single question with a recommendation and
decided by the user (W. Schenk), 2026-08-23.

| # | Question | Verdict |
| --- | --- | --- |
| 1 | Implement the paper ourselves, or depend on Cordis? | Implement ourselves |
| 2 | UI-only, or habitat internals too? | All the way down, staged through the UI |
| 3 | Package name | `@umwelten/substrate`, zero deps, isomorphic |
| 4 | V1 scope | Effects, coeffects, lifecycle, loader + HMR, isolation; interception deferred |
| 5 | Relation to A2A / mcp-ui | Projection model (ADR 0032), after the user flagged it needed normalizing |
| 6 | Render contract | Web components; substrate never prescribes a view library |
| 7 | Trust model for authored components | Full trust in own habitat; iframe at the habitat boundary (ADR 0033) |
| 8 | First assembly | The habitat's own UI, replacing `public/index.html` |
| 9 | Patch the live `remove_custom_tool` staleness bug in the old registry? | No — replace, don't patch; nothing is in production (ADR 0031 D7) |
| — | Is Gaia a different build? | No — one framework, one shell; peer-mounting is a general capability, Gaia its first heavy user |

## Staging

1. **Core** — `@umwelten/substrate`: `ctx.effect` with tracked inverses,
   provide/inject with activate/deactivate, component lifecycle, loader with
   reconciliation + HMR, isolation. Tested against the paper's laws.
2. **First assembly** — the habitat shell (chat, discovery, mounting) plus
   the habitat's own components; `public/index.html` (3,184 hand-written
   lines, a dozen bespoke `/api/*` routes) retires as components replace it.
3. **Self-assembly** — `create_component` beside `create_tool`; modules in
   `workDir/components/` land live through the loader's HMR.
4. **Peer-mounting** — publish components as MCP resources in the `ui://`
   namespace, mount foreign ones behind the iframe boundary. Gaia's
   dashboard becomes an assembly of this.
5. **Mycel client surface** — same shell, exchange components; the Mycel
   server keeps zero internal deps.
6. **Internals migration** — tool sets, connectors, runtimes become
   components on the same tree. This is where the old tool registry's known
   defects (stale tools after `remove_custom_tool`, non-transactional
   `reload_tools`) die, per the replace-don't-patch verdict.

## Parked — real ideas, not yet grilled

These came out of the paper/DSH review but were **not** put through this
session; they carry no decisions.

- Mounting external coding harnesses (DeepSeek Harness, codex resume) as
  declared runtimes behind the RuntimeRunner seam, with `{session}` resume
  templating and a pluggable output parser.
- Interception as within-habitat access control (substrate v2 candidate).
- Naming note held over: "capabilities" is taken by credential contracts
  (`CapabilityBinding`); any future discovery endpoint should use surface
  language, not capability language.

## Background reading

- `reports/` has no entry for this yet; the paper review lives in session
  history. The paper: github.com/cordiverse/paper. The comparison point:
  DeepSeek Harness (deepseek-ai/deepseek-harness), which vendors Cordis and
  validates the "everything is a plugin" shape for an agent harness.
- ADR 0005 — UI resources over A2A and MCP: the wire machinery ADR 0032
  builds on (server half implemented; artifact-URL defect fixed).
- ADR 0018 — one task substrate, two protocol projections: the normalization
  pattern ADR 0032 repeats for UI.
