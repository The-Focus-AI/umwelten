# Umwelten Context

Umwelten helps agents preserve, revisit, and reason about their work across conversations. Its language distinguishes the raw conversation sent to a model from the higher-level groupings and reflections that make that work communicable later.

## Language

**Interaction**:
A flat conversation context exchanged with a model for one continuing line of work.
_Avoid_: Session, transcript, memory

**Source Session**:
A persisted conversation artifact produced by a tool such as pi, Claude Code, Cursor, or Habitat.
_Avoid_: Interaction when referring to tool-specific storage

**Exploration**:
A line of inquiry represented by one or more **Source Sessions** and their derived **Interactions**.
_Avoid_: Question, session abstraction, conversation bundle, session tree

**Saved Exploration**:
A named **Exploration** persisted in the project so it can be referenced later.
_Avoid_: Folder, collection, saved search when referring to the domain concept

**Exploration Browser**:
The user-facing workspace for inspecting **Explorations** and launching **Reflections** about them.
_Avoid_: Knowledge browser, browse session

**Session Search**:
A system-wide, full-content search across every **Source Session** on disk, regardless of project. Returns matching **Source Sessions** rather than **Explorations**; opening a hit lets the normal browser path lazily project it into a default **Exploration** for digesting or reflection.
_Avoid_: Project search (too narrow), index search (no index), grep (implementation detail)

**Project Fact**:
Stable knowledge about this codebase or project that helps future work.
_Avoid_: Agent instruction, report, raw observation

**Memory**:
Knowledge derived from reflecting on one or more **Interactions** or **Explorations**.
_Avoid_: Raw transcript, session log

**Reflection**:
The act of creating an **Interaction** that asks questions about other **Interactions** or **Explorations**.
_Avoid_: Indexing, analysis, digesting when used as generic names, separate runner

**Saved Reflection**:
A persisted answer from a **Reflection** that has not necessarily been promoted into a **Project Fact**, **Skill**, **Artifact**, or agent instruction.
_Avoid_: Memory when it is only a holding-area answer

**Skill**:
A reusable procedure derived from past work.
_Avoid_: Playbook, learning, skill candidate when referring to the promoted artifact

**Skill Candidate**:
A possible **Skill** identified during **Reflection** or digest extraction but not yet promoted.
_Avoid_: Playbook, procedure finding

**Artifact**:
A dated output produced from an **Exploration** for human use or publication.
_Avoid_: Report when referring to the general category

## Relationships

- Every **Source Session** belongs to at least one **Exploration**.
- By default, each **Source Session** starts as its own **Exploration**.
- An **Exploration** may combine multiple **Source Sessions** when they belong to the same line of inquiry.
- Search results and inferred groupings may be virtual **Explorations** until a user or agent names and saves them.
- A **Saved Exploration** gives an **Exploration** a stable project-local name for later reference.
- The **Exploration Browser** presents **Explorations** and can launch **Reflections** about them.
- Project-local Umwelten files should be human-readable and hand-editable by default.
- Working data produced by the **Exploration Browser** lives under the project-local `.umwelten/` directory.
- When extracting working data, the **Exploration Browser** should prioritize the newest undigested **Explorations** first.
- Confirmed extraction should process both missing and stale working data.
- An **Exploration** contains one or more **Interactions** connected by relationships such as forks, handoffs, alternatives, cleaned paths, and derived outputs.
- An **Interaction** may belong to one or more **Explorations**.
- **Reflection** uses the existing model runner by constructing a new **Interaction** whose context includes relevant material from other **Interactions** or **Explorations**.
- A reflective **Interaction** produces answers; an agent may save those answers as **Saved Reflections** or promote them into durable **Memory**.
- A **Skill Candidate** may be promoted into a **Skill**.
- A **Skill** is a procedural kind of **Memory**.
- A **Project Fact** should live in the top-level `FACTS.md` file.
- `FACTS.md` is freeform Markdown, not a marker-managed machine section.
- An **Artifact** may be Markdown, HTML, or another published output format and should be dated.
- **Artifacts** live in `.umwelten/artifacts/` and use `YYYY-MM-DD-slug.ext` filenames.
- Agent instruction files should prefer `AGENTS.md` going forward; `CLAUDE.md` remains a compatibility target.
- Reflected additions to agent instruction files should live inside a `## Reflections` section bounded by `<!-- umwelten:reflections:start -->` and `<!-- umwelten:reflections:end -->` markers.
- Use `FACTS.md` for declarative truths about the project; use `AGENTS.md` for imperative guidance to agents.
- Put gotchas in `AGENTS.md` when they imply future behavior, in `FACTS.md` when they describe a surprising truth, and in a **Skill** when they belong to a repeatable procedure.
- Project-local user/work-style memory belongs in `.umwelten/user-model.md`.
- **Saved Reflections** live in `.umwelten/reflections/` and use dated Markdown files.
- **Session Search** operates on every **Source Session** the registered adapters can discover, not just those rooted in the current project. It returns **Source Sessions**, not **Explorations** — promotion to an **Exploration** happens when the user opens a hit in the **Exploration Browser**.

## Example dialogue

> **Dev:** "Should this fork become a new Interaction or mutate the existing one?"
> **Domain expert:** "A fork creates a new **Interaction**. The **Exploration** lets us ask how that Interaction relates to the others; if we want to refer to that group later, we save it as a **Saved Exploration**."

## Flagged ambiguities

- "session" was used to mean raw model context, saved transcript, external tool history, and grouped work. Resolved: use **Interaction** for the model-facing conversation, **Source Session** for tool-specific persisted history, and **Exploration** for the grouping across related work.
- "knowledge browser" and "browse session" were used for the same user-facing workflow. Resolved: use **Exploration Browser** for the entrypoint, and reserve **Reflection**, **Memory**, **Project Fact**, and **Skill** for the knowledge objects/actions it surfaces.
- "playbook" was used for reusable procedures found during extraction. Resolved: use **Skill Candidate** before promotion and **Skill** after promotion.
