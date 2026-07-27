# Reflections & Knowledge

A **Reflection** is an Interaction that asks questions *about* other Interactions
or [Explorations](./explorations.md). Its answers start as throwaway text; the
useful ones get **promoted** into files that outlive the conversation.

The pipeline:

```
Exploration → Reflection → answer → classify → promote → a file in the repo
```

> **Status:** this pipeline is a programmatic API. There is **no top-level
> `umwelten knowledge` command** — the closest CLI surface is
> `umwelten sessions digest knowledge`, which shows knowledge accumulated by
> digestion rather than driving promotion. Everything below is TypeScript.

## Reflecting

`buildReflectiveInteraction` constructs an Interaction whose system prompt is a
reflective analyst plus the context of the Explorations you're asking about. It
is not a new runner — just a configured Interaction, so it streams, costs, and
persists like any other.

```typescript
import { buildReflectiveInteraction } from "@umwelten/core/interaction/reflection/reflection.js";

const interaction = buildReflectiveInteraction(
  explorations,
  "What did we decide about auth token refresh, and did it stick?",
  { model },
);
const response = await interaction.streamText();
```

To ask several questions at once over a *live* conversation instead of saved
Explorations, use [Turn Fan-out](./turn-fanout.md).

## Promotion

An answer is worth keeping in different places depending on what kind of thing
it is. `classifyReflectionAnswer` decides which:

```typescript
import { classifyReflectionAnswer } from "@umwelten/core/interaction/promotion/classifier.js";
import { PromotionRouter } from "@umwelten/core/interaction/promotion/index.js";

const decision = classifyReflectionAnswer(response.content);
await new PromotionRouter(projectPath).promote(decision);
```

Eight targets, each with its own writer:

| target | lands in | for |
|---|---|---|
| `agent-instruction` | `AGENTS.md` (`CLAUDE.md` for compatibility) | imperative guidance to future agents |
| `project-fact` | `FACTS.md` | declarative truths about the project |
| `domain-language` | `CONTEXT.md` | a term and what to avoid calling it |
| `adr` | `docs/adr/` | a decision that was hard to reverse |
| `skill` | a Skill draft | a repeatable procedure |
| `artifact` | `.umwelten/artifacts/YYYY-MM-DD-slug.ext` | a dated output for humans |
| `saved-reflection` | `.umwelten/reflections/` | worth keeping, not yet worth promoting |
| `user-model` | `.umwelten/user-model.md` | how this person works |

### Choosing between them

The distinction that gets muddled most often:

- **`FACTS.md`** is declarative — *what is true*. "The Gaia dashboard runs on
  7420."
- **`AGENTS.md`** is imperative — *what to do*. "Always run `pnpm test:run`, never
  `pnpm test`."

A gotcha goes in `AGENTS.md` if it implies future behaviour, in `FACTS.md` if
it's a surprising truth, and into a Skill if it's a repeatable procedure.

`saved-reflection` is the holding area. Use it when an answer is clearly worth
keeping but you don't yet know where it belongs — promoting too eagerly fills
`FACTS.md` with things that turn out to be wrong.

### Marker-managed sections

Writers that touch shared files insert into bounded regions rather than
appending, so re-promotion updates in place instead of duplicating:

```markdown
## Reflections
<!-- umwelten:reflections:start -->
...generated content...
<!-- umwelten:reflections:end -->
```

`FACTS.md` is the exception — freeform Markdown, not a machine section. Edit it
by hand freely.

## Skill candidates

A **Skill Candidate** is a possible procedure spotted during reflection or
digest extraction but not yet promoted. Candidates live in
`.umwelten/candidates/`; promoting one turns it into a Skill. The two-step exists
because most candidates don't survive contact with a second use.

## Explicit fact extraction

Separate from the promotion pipeline, `packages/core/src/memory/` offers direct
helpers for pulling facts out of a conversation and reconciling them against a
store you manage:

```typescript
import { extractFacts } from "@umwelten/core/memory/extract_facts.js";
import { determineOperations } from "@umwelten/core/memory/determine_operations.js";

const facts = await extractFacts(interaction, modelDetails);
const ops = await determineOperations(modelDetails, facts, existingMemories);
// ops: ADD / UPDATE / NONE against a caller-managed store
```

There is no automatic chat memory. `Interaction` always uses the base runner;
memory is something you do deliberately, not a runner mode.

For the per-session equivalent — append-only typed learnings under a habitat
session directory — see [Source Sessions](./source-sessions.md#habitat-sessions).

## Where things live

```
AGENTS.md                      # imperative guidance (CLAUDE.md for compat)
FACTS.md                       # declarative project truths
CONTEXT.md                     # domain language
docs/adr/                      # decisions
.umwelten/
  reflections/                 # saved answers, dated
  artifacts/                   # YYYY-MM-DD-slug.ext
  candidates/                  # skill candidates
  explorations/                # saved exploration manifests
  user-model.md                # how this person works
```

Everything project-local is human-readable and hand-editable by design. If a
promotion writes something wrong, fix the file.
