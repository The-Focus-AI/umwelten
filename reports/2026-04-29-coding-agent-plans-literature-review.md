# Writing Plans for Coding Agents: A Literature Review

*Date: 2026-04-29 | Sources: 16*

---

## Abstract

The rise of capable coding agents (Claude Code, Cursor, Aider, GitHub Copilot
Workspace, Kiro, and others) has revived a software-engineering question that
predates LLMs by half a century: how detailed should a written plan be before
implementation begins, and what makes one a useful artifact versus a
ceremonial one? This review surveys the contemporary literature on planning
artifacts for coding agents — plan mode, spec-driven development (SDD),
`AGENTS.md` / `CLAUDE.md` guidelines, and verifier-agent patterns — and
locates them in a 50-year lineage of software specification practice: IEEE
830 SRS documents, Z notation and formal methods, Knuth's literate
programming, Beck's TDD, North's BDD, and the modern RFC / Architecture
Decision Record (ADR) tradition. Four themes recur across both eras: (1)
plans must capture *rationale* and *alternatives*, not just decisions; (2)
the right *level of specification* lies between vague prompts and
exhaustive specs, with iteration on the spec replacing waterfall's "freeze";
(3) *validation must be designed into the artifact*, via executable
acceptance criteria, conformance suites, or verifier agents with separate
context; and (4) *separation of planning from execution* — a Squarespace RFC
approval gate, a TDD red-green cycle, or a Claude Code plan-mode session —
is what converts an agent from a vibe-coder into a reviewable contributor.
The contested areas are the failure modes of over-specification (review
burden, false confidence, model-driven-development echoes) and how to keep
specs alive without the documentation drift that buried earlier methodologies.

---

## Introduction

### Background

Software engineering has been arguing about specifications since Royce's
1970 waterfall paper. The IEEE 830 SRS standard (1984/1998) codified the
"shall" sentence as the unit of requirement; Abrial's Z notation (1977)
pushed specification into formal logic; Knuth's *Literate Programming*
(1984) reframed code itself as exposition; Beck's TDD (late 1990s) and
North's BDD (2007) made tests the executable specification; and the modern
RFC / design-doc tradition at Google, Amazon, Squarespace, and Uber
re-instituted prose deliberation upstream of code [1][2][3][4][5][6][7].

In late 2024–2026 the question returned with a new actor: an LLM coding
agent that can write working code from a paragraph of prose, but that
hallucinates, drifts, and silently violates invariants when prose is
ambiguous. Claude Code's Plan Mode, GitHub's Spec Kit, AWS-backed Kiro,
Tessl, and a wave of `AGENTS.md` / `CLAUDE.md` conventions all converged on
the claim that the artifact preceding agent execution is now the most
leveraged document in the development loop [8][9][10][11][12].

### Purpose

This review consolidates the current literature on what a *plan for a
coding agent* should contain, and traces each recommendation back to its
historical antecedent. It targets practitioners writing such plans
day-to-day and authors of agent tooling who must decide what artifacts to
prescribe.

### Scope

- **Time period:** 1970 (Royce) — April 2026, with weight on 2024–2026
  agent-specific literature.
- **Subtopics:** plan/spec content and structure; level of detail;
  rationale documentation; supporting documents; validation and acceptance
  criteria; separation of planning and execution.
- **Out of scope:** internal LLM planning algorithms (chain-of-thought,
  ReAct, tree-of-thoughts), tooling implementation details, organisational
  RFC governance.

---

## Methodology

### Search Strategy

Web search across vendor blogs (Anthropic, Cursor, OpenAI, AWS, Microsoft,
GitHub), independent practitioner writing (Martin Fowler / Birgitta
Böckeler, Marc Brooker, Armin Ronacher, Addy Osmani, The Pragmatic
Engineer), academic-adjacent encyclopedic sources (Wikipedia, IEEE,
SEBoK), and historical primary sources (Knuth, Beck via Tidy First,
Squarespace Engineering, joelparkerhenderson/architecture-decision-record).
Queries combined the phrases *plan*, *spec*, *RFC*, *ADR*,
*acceptance criteria*, *literate programming*, *Z notation*, *waterfall*,
*BDD*, with modifiers for *coding agent*, *AI agent*, *Claude Code*, and
*Spec Kit*.

### Inclusion Criteria

- First-party documentation from agent vendors (Anthropic, Cursor, GitHub,
  AWS) for ground-truth on tooling intent.
- Practitioner essays from authors with public track records on the topic
  (Fowler bliki contributors, Pragmatic Engineer, Ronacher, Brooker).
- Encyclopedic / standards sources for historical anchors.
- Sources dated 2024 or later for the *agent-specific* claims; older
  sources only for historical lineage.

### Exclusion Criteria

- Promotional content from tool vendors lacking concrete recommendations.
- Listicles ("Top 10 AI Coding Tools") with no original analysis.
- Single-tutorial blog posts that merely paraphrase vendor docs.

---

## Thematic Review

### Theme 1: What goes into the plan — content and structure

#### Historical Development

The IEEE 830 SRS (first published 1984, revised 1998, superseded by
ISO/IEC/IEEE 29148:2011) prescribed sections for purpose, scope, definitions,
overall description, specific requirements (functional and
non-functional), and external interface requirements; its hallmark was
the "*The system shall…*" sentence as the atom of specification [1]. Z
notation (Abrial, 1977; industrialised at IBM Hursley/Oxford on CICS/ESA
v3, 1989) replaced English with set-theoretic schemas, trading
readability for mathematical verifiability and earning the 1992 Queen's
Award for Technological Achievement [2].

The agile turn after 2001 fragmented the SRS into user stories plus
acceptance criteria, while the *upstream* design conversation moved into
RFCs and design docs. The Pragmatic Engineer's survey of Google, Uber,
Amazon, Squarespace, Sourcegraph, HashiCorp, Razorpay, Stedi, Couchbase,
and Monzo found a remarkably consistent skeleton: **context / scope, goals
& non-goals, system diagrams, APIs, data storage, alternatives considered,
risks, observability** [4]. Squarespace's variant explicitly added an
*approvers* section so that "if the approvers don't say yes, implementation
won't start" [5].

Architecture Decision Records (ADRs), popularised by Michael Nygard and
catalogued by joelparkerhenderson, narrowed the design-doc form to a
single decision per file: *context, decision, status, consequences* [3].
AWS Well-Architected formalised this further, recommending status fields
(`Proposed | Accepted | Superseded`), supersession links, and central
storage [3].

#### Current State

The 2025–2026 literature on coding agents converges on a remarkably
similar list of sections, now reframed for an LLM consumer. Addy Osmani's
"How to write a good spec for AI agents" (also republished on O'Reilly
Radar) prescribes six core areas: **commands** (executable, with flags),
**testing**, **project structure**, **code style**, **git workflow**, and
**boundaries** [13]. The boundaries get an unusual three-tier shape that
has no exact pre-LLM analogue:

> ✅ **Always do** – Safe actions requiring no approval
> ⚠️ **Ask first** – High-impact changes needing human review
> 🚫 **Never do** – Hard stops (secrets, vendor directories) [13]

GitHub's Spec Kit formalises a four-phase artifact set —
**Constitution → Specify → Plan → Tasks** — in which the *Constitution* is
a foundational rules file (analogous to an `AGENTS.md` or a coding
standard) and *Specify* / *Plan* / *Tasks* progressively narrow scope [9].
Kiro enforces a three-phase variant — **Requirements → Design → Tasks** —
with EARS-notation acceptance criteria in the requirements phase [10][14].
Stack Overflow's house guidance (March 2026) recommends keeping such
guidelines in `agents.md` files in the repo, distinct from per-task plans,
and including a *gold-standard reference file* "demonstrating all
guidelines applied together" [12].

For per-task plans (the artifact this review most directly concerns),
Armin Ronacher's analysis of Claude Code Plan Mode characterises a good
plan as:

> "Concise enough to scan quickly, but detailed enough to execute
> effectively… include paths of critical files to be modified… contain
> only your recommended approach, not all alternatives." [11]

This last point — *only the recommended approach* — is a notable
*divergence* from the RFC/ADR tradition, which mandates an "alternatives
considered" section. Plans for agents are execution artifacts; RFCs are
deliberation artifacts. Several authors recommend keeping the deliberation
in a separate document (an ADR or scoping doc) and the plan tightly
scoped to the chosen path [11][13].

#### Debates and Controversies

The contested question is **how much rationale belongs in the plan
itself**. Squarespace and AWS guidance for ADRs is unambiguous: "A record
without justification loses its value over time as stakeholders can't
evaluate whether the decision still applies when circumstances change"
[3][5]. Addy Osmani agrees that domain rationale should be embedded
inline ("If using library X, watch out for memory leak issue in version
Y… apply workaround Z") [13]. Ronacher pushes the other way: alternatives
clutter the executable plan and should live elsewhere [11]. Birgitta
Böckeler, surveying Spec Kit and Kiro on Fowler's site, levels a sharper
charge against high-ceremony plans — *"To be honest, I'd rather review
code than all these markdown files."* [8]

### Theme 2: The right level of specification

#### Historical Development

The waterfall model (Royce 1970, formalised by DoD-STD-2167 et al.) sits
at one extreme: a complete SRS frozen before design [15]. Its failure mode
— "clients may not know the exact requirements before they see working
software… leading to redesign, redevelopment, and retesting" — is the
canonical critique [15]. Z notation pushed specification *further* into
formality but conceded "expensive, slow, and require[d] domain expertise"
in human terms [2][16].

Agile's user stories deliberately under-specified upfront: short
narratives ("As a *role*, I want *capability*, so that *benefit*") that
"get more specific as you have more discussions and as the iterations of
the project continue" [15]. BDD (Dan North, 2007) tightened the screw
back: stories must come with executable Given-When-Then scenarios in
ubiquitous language, written by business + dev together [6]. TDD (Beck,
late 1990s) made the test itself the specification, with red-green-refactor
as its iteration unit [7]. Knuth's literate programming took a third
route: collapse documentation and code into a single woven artifact whose
prose is "not an add-on, but is grown naturally in the process of
exposition of one's thoughts" [17].

#### Current State

The 2026 consensus on coding-agent plans rejects both extremes. Addy
Osmani warns: *"Most agent files fail because they're too vague,"* but
also names a "curse of instructions" in which "as requirements multiply,
model adherence drops significantly" [13]. Cursor's official guidance
puts it operationally:

> "If you could describe the diff in one sentence, skip the plan." [18]

Plan Mode, in their framing, is for changes that are **multi-file,
ambiguous, or in unfamiliar code**, and especially for "risky changes
like database migrations, auth changes, and deployment configs — anything
where a wrong move is expensive to undo" [18][19].

A more theoretical decomposition comes from Birgitta Böckeler, who
identifies three levels of spec-driven development with AI [8]:

| Level | What it means | Tool exemplars |
|---|---|---|
| **Spec-first** | Write detailed spec, generate code, discard spec | Kiro |
| **Spec-anchored** | Maintain spec across feature evolution | Spec Kit (partial) |
| **Spec-as-source** | Spec is the primary artifact; code is generated and not hand-edited | Tessl |

She is openly sceptical of spec-as-source: *"it combines the
inflexibility *and* the non-determinism — rather than solving either"* —
and explicitly draws a parallel to past Model-Driven Development
failures [8].

Marc Brooker counters the obvious "isn't this waterfall?" critique
directly:

> "The specification is the thing being iterated on, rather than the
> implementation… It is extremely rare for a software project to know all
> of the requirements up-front." [20]

His framing is that SDD raises the abstraction level from code to spec
the same way prior eras raised it "from switches, to gates, to
instructions, to lines of code" [20]. The spec is not frozen pre-coding;
it is the locus of iteration, with the agent regenerating the
implementation each time the spec changes.

For *task decomposition* inside the plan, the literature converges on
three properties [21][22]:

- **Specific** — clear enough that the agent knows exactly what to do
- **Achievable** — within the agent's tools and capabilities
- **Ordered** — later steps can build on earlier ones

This restates, almost word for word, the SMART criteria that 1980s
project-management literature applied to deliverables.

#### Debates and Controversies

Two unresolved questions.

**(1) Does process scale down?** Böckeler observes that "When I asked
Kiro to fix a small bug, it quickly became clear that the workflow was
like using a sledgehammer to crack a nut" [8]. Cursor and Anthropic both
explicitly tell users to *skip plan mode* for trivial diffs [18][19]. But
no tool reliably auto-detects which class a request falls into; the human
is still the routing layer.

**(2) Does plan ceremony create false confidence?** Böckeler again:
*"Just because the windows are larger, doesn't mean that AI will properly
pick up on everything that's in there"* [8]. The risk is that producing a
detailed-looking plan signals safety to reviewers who then approve more
quickly than they would have without one — the same pathology that
periodically discredits heavyweight requirements documents.

### Theme 3: Documenting rationale and supporting context

#### Historical Development

ADRs make rationale a first-class section: every record has a *Context*
clause explaining the forces in play and a *Consequences* clause
spelling out what the decision rules in and out [3]. Stedi's design-doc
template includes a *Decision* section addressing the stated requirements,
explicitly paired with *Consequences* [4]. Monzo's variant adds a
mandatory *Risks (must have!)* section, reflecting financial-services
priorities [4]. Knuth's literate programming pushed rationale all the way
into the source itself: *"good programmers… document the thought
processes that led them to the chosen implementation; describing not
only what the code does, but why"* [17].

#### Current State

For coding-agent plans, the literature recommends a hierarchical
disclosure pattern that traces back to ADR practice but adapts to the
LLM's context window:

- A **high-level vision statement** answering *who is the user, what do
  they need, what does success look like* [13]
- An **extended Table of Contents with summaries** condensing detailed
  sections into key points with reference tags [13]
- Rationale embedded **at the point of relevance** rather than
  centralised: e.g. "If using library X, watch out for memory leak issue
  in version Y (apply workaround Z)" [13]
- **Concrete examples over prose**: *"One real code snippet showing your
  style beats three paragraphs describing it"* [13]

For longer-lived rationale, the recommendation is to push it *out* of the
plan and into a separate ADR-shaped document. Anthropic's Claude Code
docs and several practitioner essays (Ronacher, Osmani) describe a
two-document pattern: a versioned, ADR-style decision document for *why
we chose this approach*, plus a per-task plan or task list for *what the
agent should do next* [11][13][19].

The supporting-documents question — what should travel *with* the plan —
gets surprisingly consistent answers:

- The **repo-level guidelines** (`AGENTS.md` / `CLAUDE.md`) acting as
  agent-readable coding standards [12]
- A **gold-standard reference file** in the codebase demonstrating those
  guidelines applied [12]
- **Test invocation commands** with full flags, not tool names [13]
- **Existing related code paths** the agent should read first [11]
- **Sample inputs/outputs** that the implementation must produce [13]

#### Debates and Controversies

The unresolved tension is between *just-in-time* and *just-in-case*
context. ADR practice favours capturing *all* the considered
alternatives so future maintainers can reconstruct the decision space.
Plan-mode practice favours pruning to the recommended approach to keep
the agent on rails. Several authors split the difference: alternatives
live in the ADR; only the chosen approach enters the plan; the plan
links back to the ADR by reference.

### Theme 4: Validation and acceptance criteria

#### Historical Development

Validation as an *artifact* (rather than a post-hoc activity) traces back
through three lineages:

1. **TDD (Beck, late 1990s):** the failing test *is* the specification.
   "Tests serve as executable specifications that are guaranteed to be
   up-to-date, show how code is intended to be used as examples for
   future developers, and document what the code does in specific
   situations" [7].
2. **BDD (North, 2007):** Given-When-Then scenarios in Gherkin become
   "living documentation" linkable to automated test scripts via tools
   like Cucumber [6][23].
3. **Formal methods (Z, B-Method, Alloy):** specifications become
   *provable*, with mechanical refinement from spec to implementation
   [2][16].

#### Current State

For coding-agent plans, four validation strategies recur in the
literature, each with a clear historical antecedent:

| Strategy | What it is | Antecedent |
|---|---|---|
| **Conformance suites** | YAML/JSON test cases defining input→output, language-independent | IEEE 830 verifiability, contract testing |
| **Acceptance criteria in plan** | Given-When-Then or EARS-notation in the plan/spec itself | BDD, Gherkin, Cucumber |
| **Verifier-agent pattern** | Separate agent with separate context evaluates the implementer's output | Code review, separation of duties |
| **LLM-as-judge** | Model-based scoring against rubric, calibrated against humans | Heuristic evaluation, expert review |

Anthropic's "Demystifying evals for AI agents" categorises evaluators into
three types — **code-based graders** (fast, cheap, deterministic, brittle
to valid variation), **model-based graders** (flexible, non-deterministic,
need calibration), and **human graders** (gold standard, expensive) —
and recommends combining them in *capability evals* (low pass rate,
target for improvement) and *regression evals* (near-100 % pass rate,
guard against backsliding) [24]. Two metrics handle agent
non-determinism: **pass@k** (any of k attempts succeeds) and **pass^k**
(all k attempts succeed; emphasises consistency) [24].

The verifier-agent pattern is the most distinctive contribution of the
agent era. Quoting one practitioner essay:

> "Don't ask the same agent to write code and verify it; instead, the
> validator should be a separate agent with a separate prompt, separate
> context, and explicit permission to fail the work — this separation is
> what makes the gates trustworthy." [25]

This recapitulates the principle behind code review itself, and behind
the segregation of test authors from implementation authors in
safety-critical domains. Google's VeriGuard framework formalises it for
agents by "interactively verif[ying] policies and the actions" of an
agent against safety/security specifications [21].

For plans specifically, the modern recommendation is to **embed
acceptance criteria in the plan as the gating output**: the plan should
end in a checklist of conditions the implementation must satisfy, the
implementer agent self-verifies, and a separate verifier (agent or
human) signs off [13][24][25].

#### Debates and Controversies

How much can be auto-validated? Anthropic notes that code-based graders
"struggle with valid variations that don't match expected patterns
exactly" [24]. LLM-judges are non-deterministic and need human
calibration. The honest answer in the literature is that full
auto-validation only works for narrow, well-defined components
(calculators, structured APIs, database queries); open-ended changes
still need human review on samples [24][26].

A second debate is whether validation lives *in the plan* or *separate
from it*. BDD says co-located: the Gherkin scenarios are the plan.
Spec Kit and Kiro generate task lists that include verification steps.
ADR practice keeps validation out of the decision record entirely. The
emerging coding-agent norm appears to be: acceptance criteria in the
plan, full eval suite in a separate, longer-lived directory.

---

## Synthesis

### Consensus Areas

Across pre-LLM and post-LLM literatures, the following propositions are
broadly uncontested:

1. **Rationale must be captured.** Every mature practice — ADRs, RFCs,
   design docs, BDD scenarios, literate programming — explicitly
   documents the *why*. Coding-agent plans inherit this directly.
2. **The plan is for review before execution.** Squarespace's "approvers"
   gate, TDD's red phase, and Claude Code's read-only plan mode are all
   the same idea: separate deliberation from action so a human can
   intervene cheaply.
3. **Acceptance criteria belong upstream.** From IEEE 830's verifiability
   requirement, through BDD's Given-When-Then, to modern
   verifier-agent patterns, the consensus is that "done" must be defined
   before "doing".
4. **Specifications must be maintained, not frozen.** Brooker's "spec is
   the thing being iterated on" is the same insight that drove agile's
   rejection of waterfall.
5. **Examples beat abstractions.** Knuth ("explain to human beings"),
   Beck (concrete failing tests), North (concrete scenarios), Osmani
   ("one real code snippet beats three paragraphs"), Stack Overflow
   (gold-standard reference file).

### Contested Areas

1. **How much rationale in the plan vs in a separate document.** ADR
   tradition embeds it; plan-mode tradition prunes it.
2. **How heavy the process should be for small changes.** Spec Kit and
   Kiro draw fire for "sledgehammer to crack a nut" workflows; Cursor
   and Anthropic explicitly tell users to skip planning when a
   one-sentence diff suffices.
3. **Whether spec-as-source is viable.** Tessl's bet is that humans
   should edit only specs; Böckeler argues this revives Model-Driven
   Development's failures.
4. **How much can be auto-validated.** Code-graders, LLM-judges, and
   verifier agents each have known failure modes; the literature has
   not converged on when each is sufficient.

### Emerging Trends

- **Tiered boundaries** (`always-do / ask-first / never-do`) are a
  genuinely new artifact class with no clean pre-LLM analogue, driven
  by the agent's autonomy and blast radius.
- **Two-document patterns** are stabilising: a long-lived
  guidelines/constitution file (`AGENTS.md`, `CLAUDE.md`,
  `Constitution.md`) plus per-task plans that reference it.
- **Verifier agents with separate context** are emerging as the agent
  era's contribution to the validation lineage — distinct enough from
  code review that it is unlikely to collapse into it.
- **Pass@k / pass^k metrics** are migrating from research evals into
  practitioner CI for agent-authored code, formalising the
  non-determinism problem.

---

## Gaps and Future Directions

Several questions remain open in the literature:

1. **Auto-routing of plan ceremony.** No tool reliably decides whether a
   request needs a 200-line plan, a 5-line plan, or none. This
   decision still falls on the human, who is not always best placed.
2. **Plan/code drift.** ADR literature has decades of evidence that
   decision records become stale without explicit maintenance rituals.
   Whether per-task plans suffer the same fate, or whether their short
   half-life immunises them, is empirically unsettled.
3. **Cross-agent plan portability.** GitHub's Spec Kit claims to work
   with 30+ agents, but no controlled study has measured whether the
   same plan produces comparable outputs across Claude Code, Cursor,
   Aider, and Codex.
4. **The economics of plan-time vs implementation-time.** Cursor reports
   teams using written specs had a 67 % lower rollback rate than teams
   prompting without specs [27], but the cost side — how much time
   plan-writing adds, and where the break-even sits for change size —
   is largely anecdotal.
5. **Formal-methods revival.** Z and TLA+ once sat at the high-ceremony
   end of the spectrum, ignored by mainstream practice as too
   expensive. With agents able to consume formal specs cheaply, whether
   a lightweight formal layer (EARS notation, contracts) becomes
   practical for ordinary work is an open empirical question.

---

## Conclusion

The current literature on writing plans for coding agents is best read
not as a new field but as the latest beat in a 50-year argument about
specification. The agent era inherits, almost item-for-item, four
deliverables from earlier practice: a *rationale* artifact (ADR), a
*scoped change* artifact (RFC / design doc / plan), an *acceptance
artifact* (BDD scenario / TDD test / conformance suite), and a *coding
standard* artifact (style guide / `AGENTS.md`). What is genuinely new is
the consumer: an agent that will execute literally, scale instantly, and
fail silently — making the *quality* of those four artifacts more
load-bearing than at any prior point in software history.

The strongest practical guidance from the literature collapses to a
short list. (1) Match plan weight to change weight: skip the plan when a
sentence will do; write one when changes are multi-file, risky, or in
unfamiliar code. (2) Capture rationale explicitly, but in the document
that will outlive the change — an ADR, not the per-task plan. (3) State
acceptance criteria in the plan itself, in a form a separate verifier
(human or agent) can check. (4) Iterate on the spec, not just on the
code. (5) Preserve a review gate between planning and execution; this is
what Squarespace's approvers, TDD's red phase, and Claude Code's plan
mode all share, and removing it converts an agent from a contributor
back into a vibe coder.

---

## References

[1] IEEE Standards Association. *IEEE Recommended Practice for Software
Requirements Specifications (IEEE 830-1998).* Background on the
"shall"-style functional requirement and the SRS section structure.
<https://standards.ieee.org/ieee/830/1222/>

[2] Wikipedia. *Z notation.* History of Abrial's 1977 proposal,
industrialisation at IBM CICS/ESA, and the 1992 Queen's Award.
<https://en.wikipedia.org/wiki/Z_notation>

[3] AWS Architecture Blog. *Master architecture decision records (ADRs):
Best practices for effective decision-making.* Section structure
(context / decision / status / consequences), rationale capture, and
storage practices. Cross-referenced with
joelparkerhenderson/architecture-decision-record (ADR templates and
catalogue).
<https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/>
and <https://github.com/joelparkerhenderson/architecture-decision-record>

[4] The Pragmatic Engineer. *Companies Using RFCs or Design Docs and
Examples of These.* Survey of Google, Uber, Amazon, Sourcegraph,
HashiCorp, Razorpay, Stedi, Couchbase, Monzo design-doc structures,
including "alternatives considered" and risk sections.
<https://blog.pragmaticengineer.com/rfcs-and-design-docs/>

[5] Squarespace Engineering Blog. *The Power of "Yes, if": Iterating on
our RFC Process.* The "approvers" gate and the design-doc-as-clarity
argument.
<https://engineering.squarespace.com/blog/2019/the-power-of-yes-if>

[6] Wikipedia. *Behavior-driven development.* Dan North's 2007 origin,
Given-When-Then format, ubiquitous language, relationship to TDD,
and known limitations.
<https://en.wikipedia.org/wiki/Behavior-driven_development>

[7] Martin Fowler (bliki). *Test Driven Development.* Beck's
red-green-refactor cycle and tests-as-executable-specification claim.
<https://martinfowler.com/bliki/TestDrivenDevelopment.html>

[8] Birgitta Böckeler (martinfowler.com). *Understanding
Spec-Driven-Development: Kiro, spec-kit, and Tessl.* Three-level taxonomy
(spec-first / spec-anchored / spec-as-source), critique of "sledgehammer
to crack a nut" workflows, and the Model-Driven Development parallel.
<https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html>

[9] GitHub. *spec-kit: Toolkit for Spec-Driven Development.*
Constitution → Specify → Plan → Tasks workflow and AGENTS.md
conventions for 30+ agents.
<https://github.com/github/spec-kit>

[10] Kiro. *Agentic AI development from prototype to production.*
Three-phase Requirements / Design / Tasks workflow with EARS-notation
acceptance criteria.
<https://kiro.dev/>

[11] Armin Ronacher. *What Actually Is Claude Code's Plan Mode?* Plan
mode as a markdown artifact; characteristics of a good plan
(concise-yet-detailed, action-oriented, recommended approach only);
relationship between planning and execution as prompt-driven rather
than enforced.
<https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/>

[12] Stack Overflow Blog. *Building shared coding guidelines for AI
(and people too).* `agents.md` files, gold-standard reference files,
explicit reasoning per guideline, and the
guidelines-vs-task-plans split.
<https://stackoverflow.blog/2026/03/26/coding-guidelines-for-ai-agents-and-people-too/>

[13] Addy Osmani. *How to write a good spec for AI agents* (and the
O'Reilly Radar version, *How to Write a Good Spec for AI Agents*). Six
spec areas; the three-tier boundary system
(always-do / ask-first / never-do); curse-of-instructions warning;
embedded rationale and concrete examples.
<https://addyosmani.com/blog/good-spec/> and
<https://www.oreilly.com/radar/how-to-write-a-good-spec-for-ai-agents/>

[14] Vishal Mysore (Medium). *Comprehensive Guide to Spec-Driven
Development: Kiro, GitHub Spec Kit, and BMAD-METHOD.* Side-by-side
comparison of three SDD toolchains and EARS notation use.
<https://medium.com/@visrow/comprehensive-guide-to-spec-driven-development-kiro-github-spec-kit-and-bmad-method-5d28ff61b9b1>

[15] Wikipedia. *Waterfall model.* Royce 1970 origin, the "frozen
requirements" failure mode, and standard critiques driving agile's
emergence.
<https://en.wikipedia.org/wiki/Waterfall_model>

[16] Wikipedia. *Formal methods.* B-Method, Z, RAISE, and the
mathematical-rigour-vs-cost trade-off in industrial formal
specification.
<https://en.wikipedia.org/wiki/Formal_methods>

[17] Wikipedia. *Literate programming*; Donald E. Knuth, *Literate
Programming* (Stanford, 1984/1992). The "explain to human beings what
we want a computer to do" thesis and the documentation-as-natural-byproduct
claim.
<https://en.wikipedia.org/wiki/Literate_programming> and
<https://www-cs-faculty.stanford.edu/~knuth/lp.html>

[18] Cursor. *Best practices for coding with agents.* Plan-mode usage
guidance, the "if you could describe the diff in one sentence, skip
the plan" heuristic, and saving plans to `.cursor/plans/`.
<https://cursor.com/blog/agent-best-practices>

[19] Anthropic / Claude Code. *Best Practices for Claude Code* and
*Claude Code power user tips.* Explore-Plan-Implement-Commit
four-phase workflow; plan mode as read-only review-before-execution.
<https://code.claude.com/docs/en/best-practices> and
<https://support.claude.com/en/articles/14554000-claude-code-power-user-tips>

[20] Marc Brooker. *Spec Driven Development isn't Waterfall.* The
"specification is the thing being iterated on" argument and the
abstraction-level lineage from switches to specs.
<https://brooker.co.za/blog/2026/04/09/waterfall-vs-spec.html>

[21] APXML / sparkco.ai / Michael Brenndoerfer. *LLM Agent Task
Decomposition Strategies* and related essays. Specific / achievable /
ordered subtask criteria; manual vs LLM-assisted decomposition; Google
VeriGuard verifier framework.
<https://apxml.com/courses/agentic-llm-memory-architectures/chapter-4-complex-planning-tool-integration/task-decomposition-strategies>
and
<https://sparkco.ai/blog/deep-dive-into-agent-task-decomposition-techniques>

[22] Augment Code. *How we solved the "AI agent black box" problem
with typed tasks.* Typed task lists as agent-execution artifact and
their role in observability.
<https://www.augmentcode.com/blog/how-we-built-tasklist>

[23] TestQuality. *Gherkin, BDD, & Cucumber: Behaviour Driven
Development Guide.* Gherkin syntax (Given/When/Then/And/But) and
living-documentation rationale.
<https://testquality.com/gherkin-bdd-cucumber-guide-to-behavior-driven-development/>

[24] Anthropic. *Demystifying evals for AI agents.* Code-based vs
model-based vs human graders; capability vs regression evals; pass@k
and pass^k; the eight-step roadmap including "grade outputs, not
specific paths agents took".
<https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>

[25] DEV Community / Bright Security. *How I Validate Quality When AI
Agents Write My Code* and *5 Best Practices for Reviewing and Approving
AI-Generated Code.* The separate-validator-agent pattern and the
"explicit permission to fail the work" argument.
<https://dev.to/teppana88/how-i-validate-quality-when-ai-agents-write-my-code-481c>
and
<https://brightsec.com/blog/5-best-practices-for-reviewing-and-approving-ai-generated-code/>

[26] SEBoK. *Verification and Validation of Systems in Which AI is a
Key Element.* Limits of automated validation for open-ended AI
behaviour and the case for sampled human review.
<https://sebokwiki.org/wiki/Verification_and_Validation_of_Systems_in_Which_AI_is_a_Key_Element>

[27] Cursor / Blink Blog. *Agentic Coding Best Practices: The 2026
Guide.* Reported 67 % rollback-rate reduction for teams using written
specs before agent runs.
<https://blink.new/blog/agentic-coding-best-practices>
