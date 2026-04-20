# Agent Skills Spec — Gap Analysis

Comparing umwelten's skills adapter (`src/stimulus/skills/`) against the [agentskills.io](https://agentskills.io/specification) spec (as of 2026-04).

## Summary

Umwelten implements the **core model faithfully** — directory-per-skill, `SKILL.md` with YAML frontmatter, progressive disclosure, dedicated activation tool. The major gaps are around **validation strictness**, **discovery conventions**, **harness behaviors** (compaction exemption, dedup, permission allowlisting), and some **frontmatter field handling**.

## Compliance Scorecard

### ✅ Core model — aligned

| Area | Status |
|---|---|
| Directory-per-skill with `SKILL.md` | ✅ |
| YAML frontmatter + markdown body | ✅ (`gray-matter`) |
| Required fields: `name`, `description` | ✅ (description required; skips if missing) |
| Optional `license`, `compatibility`, `allowed-tools`, `metadata` | ✅ (all parsed into `SkillDefinition`) |
| Progressive disclosure — metadata at startup, body on activation | ✅ (`getSkillsMetadataPrompt` + activation tool) |
| Resources on-demand (scripts/, assets/) | ✅ (referenced by relative path; not eagerly loaded) |
| Dedicated activation tool (`skill`) | ✅ (`createSkillTool`) |
| Argument substitution on activation | ✅ (`$ARGUMENTS`, `$0`, `$1` — this is an **extension**, not in spec) |

### ⚠️ Partial / divergent

| Area | Spec | Umwelten | Gap |
|---|---|---|---|
| **`name` validation** | 1–64 chars, lowercase, `[a-z0-9-]`, no leading/trailing `-`, no `--`, must match parent dir (NFKC) | No validation — accepts anything, falls back to dir basename | Invalid names load silently |
| **`description` length** | 1–1024 chars | No max length check | Over-long descriptions bloat catalog |
| **`compatibility` length** | ≤500 chars | Not validated | Minor |
| **Unknown frontmatter fields** | Spec is strict (error); lenient loading recommended | Silently ignored | No warning surface |
| **`allowed-tools` format** | Space-separated **string** (`"Bash(git:*) Read"`) | Parsed as `string[]` | Format mismatch — umwelten likely expects array; spec says string |
| **`metadata` value coercion** | Keys and values coerced to strings | Stored as `Record<string, string>` but no coercion | Non-string values may break |
| **`SKILL.md` case fallback** | Reference impl accepts `skill.md` lowercase | Only `SKILL.md` | Minor compat issue |
| **Body length recommendation** | < 500 lines / < 5000 tokens | No check or warning | No author feedback |
| **Catalog format** | `<available_skills><skill><name/><description/><location/></skill></available_skills>` XML recommended | Markdown bullet list (`- **name**: description`) | No `<location>` — model can't resolve relative paths without it |
| **Activation wrapping** | `<skill_content>` + skill dir path + `<skill_resources>` file list | Returns `{ skill, instructions, message }` JSON; no explicit skill dir, no resource enumeration | Model doesn't know skill dir for relative path resolution |
| **Discovery paths** | `.agents/skills/` (cross-client) + `.<client>/skills/` at project AND user scope; project overrides user | Only `workDir/skills/` (configurable via `skillsDirs`) | No user-scope, no `.agents/` convention, no precedence rules |

### ❌ Missing entirely

| Feature | Spec says | Impact |
|---|---|---|
| **Name ↔ directory match** | `name` must equal parent dir name (NFKC) | Can have skill named `foo` in dir `bar/` — confusing |
| **Skill-content compaction exemption** | Harness should protect skill body from context compaction | Activated skills get summarized away mid-session |
| **Activation deduplication** | Within a session, same skill activated twice shouldn't re-inject | Token waste if LLM re-activates |
| **Permission allowlist on activation** | Skill dir should be auto-allowed for file reads after activation | User gets permission prompts for bundled scripts/refs |
| **Resource enumeration at activation** | List `scripts/`, `references/`, `assets/` files so model knows what's available without read-dir | Model has to guess file paths |
| **Project trust gating** | Project-level skills should be gated on user trust of the repo | Potential prompt-injection vector from cloned repos |
| **Scan safety bounds** | Depth cap (4–6), dir count cap (~2000), `.gitignore` respect | `discoverSkillsInDirectory` skips `.git`/`node_modules`/`vendor`/`.venv` but no depth/count cap |
| **User-scope skills** | `~/.agents/skills/` + `~/.<client>/skills/` | Only work-dir + git repos |
| **Project-over-user precedence + shadow warning** | Deterministic collision resolution with warnings | Last-registered-wins (`addSkills` overwrites) |
| **Lenient YAML retry** | Re-try with quoted/block-scalar on unparseable YAML | Fails outright |
| **Validation CLI** | `skills-ref validate <path>` equivalent | No `umwelten skills validate` |
| **`skill.md` lowercase fallback** | Accept both `SKILL.md` and `skill.md` | Only uppercase |

### ➕ Umwelten extensions (not in spec)

These aren't gaps — they're additions umwelten has that the spec doesn't specify:

- `disableModelInvocation`, `userInvocable`, `context`, `argumentHint` (Claude Code-ish fields)
- `$ARGUMENTS` / `$0` / `$1` argument substitution at activation
- `loadSkillsFromGit` — clone-and-discover from git URL
- `create_skill` / `reload_skills` runtime tools
- Recursive nested discovery (one repo → many skills)

## Priority Fixes

Ranked by impact vs. effort:

1. **Add `<location>` and skill-dir context at activation** (low effort, high impact) — model can't resolve relative paths to `scripts/foo.sh` without knowing the skill's absolute dir. Return `skillDir` in activation payload and include in activation message.

2. **Validate `name` format + directory match** (low effort, med impact) — currently silent acceptance of invalid names. Add validator matching spec constants (64 chars, lowercase, pattern, parent-dir match). Lenient mode: warn + load.

3. **Enumerate resources at activation** (med effort, high impact) — scan `scripts/` / `references/` / `assets/` on activation and include file list in response. Matches spec's `<skill_resources>` pattern.

4. **Fix `allowed-tools` format** (low effort, low impact) — spec says space-separated string, umwelten treats as array. Either parse string → array at load time, or keep array and document divergence.

5. **Compaction exemption** (med effort, high impact for long sessions) — `Interaction.compactContext()` should skip messages tagged as skill activations. Requires marking skill tool-result messages.

6. **Activation dedup** (low effort, med impact) — `SkillsRegistry.activateSkill` already tracks `activated: Set<string>`, but doesn't short-circuit repeat activations in the tool handler.

7. **Description length cap** (trivial) — warn/truncate at 1024 chars.

8. **User-scope skill discovery** (med effort, med impact) — scan `~/.agents/skills/` and/or `~/.umwelten/skills/` with project-overrides-user precedence.

9. **`umwelten skills validate` CLI** (med effort, low-med impact) — parity with `skills-ref validate`. Useful for authors.

10. **Project trust gating for git-cloned skills** (higher effort, high impact for untrusted repos) — gate auto-load behind a one-time user prompt per repo.

## Non-Issues

These look like gaps but aren't:

- **No JSON schema published by the spec** — so umwelten can't "conform to a schema"; the spec is code-defined in `skills-ref`.
- **No versioning / signing / distribution format in spec** — umwelten's git-clone approach is fine.
- **No cross-skill dependency mechanism in spec** — umwelten correctly doesn't invent one.
- **Spec allows client-specific extensions in `metadata`** — umwelten's top-level extension fields (`context`, `argumentHint`, etc.) technically violate the "strict mode" rule that only spec fields are allowed at top level. Moving them under `metadata` would be strict-compliant but breaks existing skills. Low priority.
