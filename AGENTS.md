# AGENTS.md

## Issue Tracking

All work is tracked on GitHub Issues.

- **Open issues**: https://github.com/The-Focus-AI/umwelten/issues
- **Ready to pick up**: Filter by label `ready-for-agent` — those are unstarted, dependencies resolved, and spec'd with acceptance criteria.
- **Starting work**: Pick the next unassigned `ready-for-agent` issue from the top of the list. Remove the `ready-for-agent` label, and add the `agent-active` label.
- **During work**: Update acceptance criteria checkboxes in the issue body as you complete them.
- **Completion**: Close the issue with a comment summarizing what was done and any follow-ups.
- **New issues**: Use `gh issue create` with a parent reference, acceptance criteria checklist, and blocked-by dependencies.
- **Local backlog**: Completed historical issues still live in `issues/` for reference, but new tracking happens exclusively on GitHub.

## Domain Language

For the domain model (Interaction, Source Session, Exploration, etc.), see [CONTEXT.md](./CONTEXT.md).
