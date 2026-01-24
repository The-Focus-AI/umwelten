**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads)
for issue tracking. Use `bd` commands instead of markdown TODOs.
See AGENTS.md for workflow details.

**CRITICAL - BD DAEMON RULES:**
- NEVER run `bd daemon start` or any daemon commands
- NEVER enable auto-sync, auto-commit, or auto-push for beads
- The daemon creates spam commits every 5 seconds - it is FORBIDDEN
- Only use direct bd commands: `bd create`, `bd update`, `bd close`, `bd list`, etc.
- Manual `bd sync` is allowed if needed, but daemon is BANNED

- make sure to run tests before building
- always use the npm run cli command to test out the cli directly without doing a build
- when planning always write out a TASKS.md that has completed, current, and planned tasks it in.  always keep it up to date
- always up pnpm instead of npm
- always use pnmp test:run instead of pnpm test
