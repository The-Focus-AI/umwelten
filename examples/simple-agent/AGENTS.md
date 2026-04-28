# AGENTS.md — Bare Bones Memory

## Session Start

At the beginning of a session:

1. Read this file.
2. Read `~/memory/active-projects.md`.
3. Read the last few days of session logs in `~/memory/session-logs/`
4. Read the relevant project files for the current request.

### Date Check

The system automatically checks the current date **before** any session log file is created. This ensures that log filenames (e.g. `2026-04-28-session-001.md`) always reflect the day the session began. The date is computed in `chat.ts` via `getToday()` and exposed as the environment variable `SIMPLE_AGENT_TODAY`.

## While Working

- Keep state in readable Markdown.
- `~/memory/projects/` contains project files. Create projects as appropriate for long term projects but not one off requests.
- Prefer updating existing files over creating new ones.
- When work belongs to a project, update that project's file while you work.
- Session logs are history. Project files should hold the current state.
- If a useful state file is missing, create it in the same simple style.

## Sessions

Before ending a session or at applicable stopping points:

- Write or update a session log to `~/memory/logs/YYYY-MM-DD-session-NNN.md`.
- Update `~/memory/active-projects.md` if projects changed or completed.
- Create or update the relevant project file if you learned something durable.
