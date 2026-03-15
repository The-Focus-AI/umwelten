# Testing Checklist

Manual verification checklist for the recent changes on `main`.

## Scope

This checklist is focused on these recent commits:

- `04601f4` — Add local workspace Habitat agents
- `233fafa` — fix(cognition): normalize input/output token usage for costs
- `9c963e5` — chore(env): auto-load `.env` for CLI and tests
- `6130866` — feat(mcp): add TezLab chat example and remote transport support
- `7b1daba` — Refactor habitat agents around workspace-first registration
- `9310b11` — Add MiniMax provider support and refresh docs

---

## Test Environment Prerequisites

Before running the checklist, verify:

- [x] Repository dependencies installed: `pnpm install`
- [x] Root `.env` exists and contains the API keys you expect to use
- [x] `MINIMAX_API_KEY` is set if testing MiniMax
- [x] `GOOGLE_GENERATIVE_AI_API_KEY` or another provider key is set for Habitat / chat tests
- [x] Docker / Dagger prerequisites are available if testing bridge spikes
- [x] TezLab account/browser access is available if testing the MCP chat example
- [x] You have at least one real local repo available to test `habitat local`

Suggested quick sanity checks:

```bash
pnpm run cli --help
pnpm run cli -- models --provider minimax
pnpm exec vitest run src/providers/minimax.test.ts --reporter=verbose
```

---

## 1. `.env` auto-loading

Related commit: `9c963e5`

### 1.1 CLI from repo root

```bash
# No filter: shows all providers you have configured (ollama/lmstudio always; others if API key in .env)
pnpm run cli -- models

# Provider-specific (require corresponding key in .env; 0 results = key missing or not loaded)
# Google: needs GOOGLE_GENERATIVE_AI_API_KEY
pnpm run cli -- models --provider google
# MiniMax: needs MINIMAX_API_KEY
pnpm run cli -- models --provider minimax
```

Verify:

- [x] Commands work without `dotenvx run --`
- [x] Provider env vars are picked up automatically from `.env` (run from repo root so `.env` is found)
- [x] No extra dotenv banner/noise appears in normal output
- [x] If `--provider google` or `--provider minimax` shows 0 models, ensure that key is in repo-root `.env`

### 1.2 CLI from nested directories

Run from repo root so `pnpm` resolves paths correctly, or use paths relative to repo root:

```bash
cd src/cli
pnpm exec tsx src/cli/entry.ts --help

cd ../../examples/mcp-chat
pnpm exec tsx ../../src/cli/entry.ts --help
```

Verify:

- [x] The loader still finds the repo `.env`
- [x] Commands behave the same from nested locations

### 1.3 Missing `.env` behavior

Temporarily move `.env` aside or run in a shell where provider vars are not present.

Verify:

- [ ] Missing env vars produce normal provider/auth errors
- [ ] The env loader itself does not crash
- [ ] CLI help still works without `.env`

### 1.4 Vitest environment loading

```bash
pnpm exec vitest run src/costs/costs.test.ts --reporter=verbose
pnpm exec vitest run src/providers/minimax.test.ts --reporter=verbose
```

Verify:

- [ ] Tests see `.env` automatically
- [ ] No wrapper command is required
- [ ] Auth-gated tests skip only when the key is actually missing

### 1.5 Direct-run scripts

```bash
pnpm tsx scripts/examples/car-wash-test.ts
pnpm tsx scripts/spike-dagger-llm.ts
```

Verify:

- [ ] Scripts load `.env` automatically
- [ ] No manual `source .env` step is required for normal local use

---

## 2. MiniMax provider support and usage/cost reporting

Related commits: `9310b11`, `233fafa`

### 2.1 Model listing

```bash
pnpm run cli -- models --provider minimax
```

Verify:

- [x] MiniMax models are listed
- [x] `MiniMax-M2.5` appears
- [x] `MiniMax-M2.5-highspeed` appears
- [x] Context lengths and pricing look sane

### 2.2 Basic one-shot prompt

```bash
pnpm run cli -- run --provider minimax --model MiniMax-M2.5 "Say hello in one sentence."
```

To see duration, token counts, and cost after the response, add `--stats`. With `--stats`, the run uses non-streaming (generateText) so usage is reported correctly for all providers (e.g. MiniMax):

```bash
pnpm run cli -- run --provider minimax --model MiniMax-M2.5 --stats "Say hello in one sentence."
```

If tokens or cost show as 0, run with `--debug-usage` to log the raw usage object and normalized result to stderr (helps debug provider/SDK usage reporting):

```bash
pnpm run cli -- run --provider minimax --model MiniMax-M2.5 --stats --debug-usage "Say hello in one sentence."
```

Verify:

- [x] Request succeeds
- [x] Response content is returned normally
- [x] No warning appears about missing prompt/completion token usage
- [x] With `--stats`, the Response Statistics block shows Duration, Tokens, and Cost (or N/A if provider doesn’t report usage)

### 2.3 Interactive chat

```bash
pnpm run cli -- chat --provider minimax --model MiniMax-M2.5
```

Send 2–3 prompts.

Verify:

- [x] Chat starts successfully
- [x] Follow-up turns work
- [x] No false warning about missing usage stats appears during responses

### 2.4 Zero / edge-case token handling

This is mostly covered by tests, but manually watch for weird output in any path that reports cost.

Verify:

- [ ] No `undefined` / `NaN` token totals are shown
- [ ] Cost reporting does not regress when usage is present as `inputTokens` / `outputTokens`

### 2.5 Provider test coverage

```bash
pnpm exec vitest run src/cognition/runner.test.ts src/providers/minimax.test.ts --reporter=verbose
```

Verify:

- [ ] Regression tests pass
- [ ] Live MiniMax generation test passes when credentials are available

---

## 3. Local workspace Habitat agents

Related commit: `04601f4`

This is one of the highest-risk areas because it changes how users can attach directly to a repo-local sub-agent.

### 3.1 Start local mode from inside a repo

```bash
cd /path/to/a/real/project
pnpm run cli -- habitat local -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] Current directory is treated as the managed project
- [ ] No clone is created
- [ ] A managed agent record is created or reused
- [ ] A `MEMORY.md` file is created in the project (or at the configured memory path)
- [ ] The session opens directly on the project sub-agent
- [ ] Asking "what does this project do?" uses repo context

### 3.2 One-shot local mode

```bash
cd /path/to/a/real/project
pnpm run cli -- habitat local -p minimax -m MiniMax-M2.5 "what files are important here?"
```

Verify:

- [ ] One-shot output works without entering REPL mode
- [ ] Session metadata is still created correctly

### 3.3 Re-run / idempotence

Run the same command twice:

```bash
pnpm run cli -- habitat local -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] Existing agent registration is reused
- [ ] Duplicate agents are not created for the same project path

### 3.4 Explicit project path

```bash
pnpm run cli -- habitat local --project /path/to/a/real/project -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `--project` overrides cwd
- [ ] The correct project is attached

### 3.5 Alias command

```bash
cd /path/to/a/real/project
pnpm run cli -- habitat here -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `here` behaves the same as `local`

### 3.6 Skip configure

```bash
pnpm run cli -- habitat local --skip-configure -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] The session still opens
- [ ] Automatic configure is skipped
- [ ] No unexpected memory/config write happens beyond registration

### 3.7 Local mode with a non-MiniMax provider

```bash
pnpm run cli -- habitat local -p google -m gemini-3-flash-preview
```

Verify:

- [ ] The feature is not provider-specific
- [ ] Same flow works with another supported model provider

---

## 4. Habitat workspace-first registration / agent tools

Related commits: `04601f4`, `7b1daba`

### 4.1 Base Habitat REPL still works

```bash
pnpm run cli -- habitat -p google -m gemini-3-flash-preview
```

Verify:

- [ ] Habitat REPL starts normally
- [ ] Existing slash commands still work (`/agents`, `/tools`, `/context`, `/onboard`)

### 4.2 Agent registration behavior

In the Habitat REPL, use the agent-related workflows that now depend on workspace-first behavior.

Verify:

- [ ] Existing registered agents still show up
- [ ] Agent status/log lookups still work
- [ ] Prompt/memory loading for managed agents still works

### 4.3 Configure managed agent contract

Use either the tool flow or `habitat local` first-run flow on a real repo.

Verify:

- [ ] Setup/run commands inferred for the agent look reasonable
- [ ] Secrets refs are preserved or inferred correctly
- [ ] Log patterns are preserved or inferred correctly
- [ ] `MEMORY.md` content is written where expected

### 4.4 Session continuity

Open the same local agent multiple times.

Verify:

- [ ] The same session / agent memory behavior is preserved as expected
- [ ] The system does not lose track of the agent directory or memory path

---

## 5. TezLab MCP chat example

Related commit: `6130866`

### 5.1 First-run OAuth flow

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Browser-based OAuth starts
- [ ] Callback completes successfully
- [ ] TezLab tools are loaded after auth
- [ ] Auth/token storage is written outside the work directory as intended

### 5.2 Repeat launch with cached auth

Run again:

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] It reuses stored credentials if valid
- [ ] It does not unnecessarily force a new login

### 5.3 REPL commands

Inside the MCP chat REPL test:

- [ ] `/help`
- [ ] `/tools`
- [ ] `/context`
- [ ] `/logout`
- [ ] `/exit`

Verify:

- [ ] Each command works
- [ ] `/help` no longer crashes
- [ ] `/logout` clears auth state

### 5.4 One-shot prompt mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts "Tell me the story of the last 10 days of my Tesla's activity."
```

Verify:

- [ ] One-shot prompt mode works
- [ ] MCP tools are actually invoked
- [ ] The command exits cleanly

### 5.5 Quiet mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --quiet "Summarize my recent Tesla activity"
```

Verify:

- [ ] Only final output is printed
- [ ] No strange streaming artifacts appear

### 5.6 Logout then re-auth

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --logout
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Logout actually clears stored credentials
- [ ] Next run requires auth again

---

## 6. Generic MCP CLI transport support

Related commit: `6130866`

### 6.1 Legacy stdio path

```bash
pnpm run cli -- mcp list
```

If you have a local MCP server, also exercise a stdio connection path.

Verify:

- [ ] Existing stdio-based MCP workflows still work

### 6.2 Remote transport argument parsing

Exercise the new CLI flags with a known endpoint or a deliberate bad URL:

```bash
pnpm run cli -- mcp connect --transport sse --url https://example.com
pnpm run cli -- mcp connect --transport websocket --url wss://example.com
```

Verify:

- [ ] `--transport` is accepted
- [ ] `--url` is accepted
- [ ] `-H/--header` parsing works
- [ ] Error messages are clean when the endpoint is invalid

### 6.3 Transport integration into Stimulus / quick connection paths

Verify manually through any existing MCP-backed flow you already trust.

- [ ] Remote transport config works where stdio-only config used to be assumed
- [ ] No regression in tool loading for MCP-backed sessions

---

## 7. Docs / examples smoke check

Related commits: `9c963e5`, `6130866`, `9310b11`, `04601f4`

Spot-check these files for copy/paste accuracy:

- [ ] `docs/index.md`
- [ ] `docs/guide/getting-started.md`
- [ ] `docs/api/cli.md`
- [ ] `docs/guide/model-discovery.md`
- [ ] `docs/guide/session-management.md`
- [ ] `docs/guide/habitat-agents.md`
- [ ] `docs/guide/mcp-chat.md`

Verify:

- [ ] Commands use `pnpm run cli -- ...` where appropriate
- [ ] No stale `dotenvx run --` guidance remains in user-facing docs
- [ ] Local-agent examples match actual CLI behavior
- [ ] MCP chat docs match the current example behavior

---

## Suggested Execution Order

If doing a quick but meaningful pass, do these first:

1. [ ] `.env` auto-loading from repo root
2. [ ] `models --provider minimax`
3. [ ] one MiniMax prompt and verify the old warning is gone
4. [ ] `habitat local` inside a real repo
5. [ ] TezLab MCP chat first-run auth and one-shot prompt
6. [ ] one stdio MCP regression check

---

## Notes / Results

Use this section to record manual outcomes.

### Passed

- [ ]

### Failed / Needs Follow-up

- [ ]

### Oddities / Observations

- [ ]