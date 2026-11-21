---
kind: standard
id: portable-agent-skills
title: Portable, Self-Contained Agent Skill Packages
source: https://standards.thefocus.ai/packs/portable-agent-skills.md
version: 1
status: in_force
---

## Intent

Ensure every installable skill folder functions standalone across agent harnesses (`skills` CLI, Pi, Claude Code, Antigravity, and project-local `.agents/skills/`) with matching kebab-case identity and zero external script or runtime package dependencies.

## Invariants

- **[kebab-skill-identity]** (*NEVER*): Every skill directory `<skills-root>/<name>/SKILL.md` **NEVER** mismatches its YAML `name:` field, never uses non-kebab-case naming, and never introduces a separate numeric skill registry.
- **[self-contained-skill-scripts]** (*NEVER*): Helper scripts referenced by a `SKILL.md` **NEVER** rely on paths outside the skill's own directory when installed individually via `skills add --skill <name>`, nor depend on third-party npm packages outside Node.js built-ins.

## Verification

1. **Skill Identity & Script Parity**: Verify `.agents/skills/{spec-extract,spec-refactor,verify-deploy}/SKILL.md` frontmatter `name:` matches each parent directory name and all bundled `scripts/check-specs.ts` copies are byte-identical.
2. **Cold-Rebuild Portability Drill**: Copy `.agents/skills/` and `docs/` into an isolated `mktemp -d` directory with no `node_modules` and verify `node --experimental-strip-types .agents/skills/spec-refactor/scripts/check-specs.ts --root <sandbox> --effective` exits `0`.
