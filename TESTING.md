# Testing Checklist

Manual verification checklist for the recent changes on `main`.

## Scope

This checklist covers all notable commits on `main` through `4edb489`:

**Features:**
- `7b1daba` — Refactor habitat agents around workspace-first registration
- `6130866` — feat(mcp): add TezLab chat example and remote transport support
- `9c963e5` — chore(env): auto-load `.env` for CLI and tests
- `9310b11` — Add MiniMax provider support and refresh docs
- `04601f4` — Add local workspace Habitat agents
- `5af8e03` — feat(evaluation): add pairwise Elo ranking module

**Bug fixes:**
- `233fafa` — fix(cognition): normalize input/output token usage for costs
- `09e9aea` — fix(cli): strip leading `--`, improve model listing errors, fix date display
- `7620d4a` — fix(google): stop using fake addedDate for models
- `aea6631` — fix(run): reliable usage/cost and stats; add `--debug-usage`
- `4edb489` — fix(minimax): normalize streaming delta.role so chat works with AI SDK

**Docs / chores:**
- `972c86e` — docs: remove dotenvx prefix from CLI examples
- `996adb6` — docs: add CHANGELOG.md
- `c448d5d` — chore: bump version to 0.4.6
- `f9de636` — docs: add pairwise ranking documentation
- `ec82826` — feat(examples): add Rivian evaluation and report scripts

---

## Test Environment Prerequisites

Before running the checklist, verify:

- [ ] Repository dependencies installed: `pnpm install`
- [ ] Root `.env` exists and contains the API keys you expect to use
- [ ] `MINIMAX_API_KEY` is set if testing MiniMax
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` or another provider key is set for Habitat / chat tests
- [ ] Docker / Dagger prerequisites are available if testing bridge spikes
- [ ] TezLab account/browser access is available if testing the MCP chat example
- [ ] You have at least one real local repo available to test `habitat local`

Suggested quick sanity checks:

```bash
pnpm run cli --help
pnpm run cli models --provider minimax
pnpm exec vitest run src/providers/minimax.test.ts --reporter=verbose
```

---

## 0. Automated test suite

Run the full test suite first. Known pre-existing failures (Ollama not running locally, missing API keys) are expected.

```bash
pnpm test:run
```

Then run the ranking unit tests (no API keys needed):

```bash
pnpm exec vitest run src/evaluation/ranking/ --reporter=verbose
```

Verify:

- [ ] Total test count is ~774+ passed
- [ ] Only pre-existing failures appear (Ollama text generation, OpenRouter auth, memory/determine_operations needing gemma3:12b)
- [ ] No new failures in `src/cli/`, `src/cognition/`, `src/providers/minimax*`
- [ ] All 21 pairwise ranking tests pass (13 elo + 8 pairing)

---

## 1. `.env` auto-loading

Related commit: `9c963e5`

### 1.1 CLI from repo root

```bash
# No filter: shows all providers you have configured
pnpm run cli models

# Provider-specific (require corresponding key in .env)
pnpm run cli models --provider google
pnpm run cli models --provider minimax
```

Verify:

- [ ] Commands work without `dotenvx run --`
- [ ] Provider env vars are picked up automatically from `.env` (run from repo root so `.env` is found)
- [ ] No extra dotenv banner/noise appears in normal output
- [ ] If `--provider google` or `--provider minimax` shows 0 models, ensure that key is in repo-root `.env`

### 1.2 CLI from nested directories

Run from repo root so `pnpm` resolves paths correctly, or use paths relative to repo root:

```bash
cd src/cli
pnpm exec tsx src/cli/entry.ts --help

cd ../../examples/mcp-chat
pnpm exec tsx ../../src/cli/entry.ts --help
```

Verify:

- [ ] The loader still finds the repo `.env`
- [ ] Commands behave the same from nested locations

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

## 2. CLI fixes and model listing

Related commits: `09e9aea`, `7620d4a`

### 2.1 Leading `--` stripping

The CLI now strips a leading `--` argument so both forms work:

```bash
pnpm run cli models              # direct
pnpm run cli -- models           # with separator (pnpm passes "--" through)
```

Verify:

- [ ] Both forms produce the same output
- [ ] No "unknown command: --" error

### 2.2 Model listing error handling

```bash
# Force an error: use a provider name that doesn't exist
pnpm run cli models --provider nonexistent
```

Verify:

- [ ] Error message includes the provider name (not a generic "failed" message)

### 2.3 Date display for Google models

```bash
pnpm run cli models --provider google
```

Verify:

- [ ] Google models show "—" for the date column (not "Unknown" or "1/1/24")
- [ ] Models from providers that do report dates still show correct dates

---

## 3. MiniMax provider support and usage/cost reporting

Related commits: `9310b11`, `233fafa`, `aea6631`, `4edb489`

### 3.1 Model listing

```bash
pnpm run cli models --provider minimax
```

Verify:

- [ ] MiniMax models are listed
- [ ] `MiniMax-M2.5` appears
- [ ] `MiniMax-M2.5-highspeed` appears
- [ ] Context lengths and pricing look sane

### 3.2 Basic one-shot prompt

```bash
pnpm run cli run --provider minimax --model MiniMax-M2.5 "Say hello in one sentence."
```

Verify:

- [ ] Request succeeds
- [ ] Response content is returned normally
- [ ] No warning appears about missing prompt/completion token usage

### 3.3 One-shot with `--stats` and `--debug-usage`

With `--stats`, the run uses non-streaming (`generateText`) so usage is reported correctly:

```bash
pnpm run cli run --provider minimax --model MiniMax-M2.5 --stats "Say hello in one sentence."
```

If tokens or cost show as 0, add `--debug-usage` to log raw/normalized usage to stderr:

```bash
pnpm run cli run --provider minimax --model MiniMax-M2.5 --stats --debug-usage "Say hello in one sentence."
```

Verify:

- [ ] `--stats` shows Response Statistics block with Duration, Tokens, and Cost
- [ ] Token counts are non-zero for MiniMax
- [ ] `--debug-usage` prints raw usage object to stderr without affecting stdout
- [ ] No `undefined` / `NaN` token totals are shown

### 3.4 Interactive chat (streaming fix)

```bash
pnpm run cli chat --provider minimax --model MiniMax-M2.5
```

Send 2–3 prompts.

Verify:

- [ ] Chat starts successfully (no `TypeValidationError` from empty `delta.role`)
- [ ] Follow-up turns work
- [ ] No false warning about missing usage stats appears during responses
- [ ] Streaming output appears token-by-token (not all at once)

### 3.5 Zero / edge-case token handling

This is mostly covered by tests, but manually watch for weird output in any path that reports cost.

Verify:

- [ ] No `undefined` / `NaN` token totals are shown
- [ ] Cost reporting does not regress when usage is present as `inputTokens` / `outputTokens`

### 3.6 Provider test coverage

```bash
pnpm exec vitest run src/cognition/runner.test.ts src/providers/minimax.test.ts --reporter=verbose
```

Verify:

- [ ] Regression tests pass
- [ ] Live MiniMax generation test passes when credentials are available

---

## 4. Local workspace Habitat agents

Related commit: `04601f4`

This is one of the highest-risk areas because it changes how users can attach directly to a repo-local sub-agent.

**Directory setup:** The CLI must be run from the **umwelten repo** (so `pnpm run cli` works). The **managed project** is either (1) the current working directory when you run the command, or (2) the path you pass with `--project`. So:

- To use **umwelten itself** as the test project: from the umwelten repo run the commands below with no `cd` and no `--project` — cwd is umwelten, so that becomes the managed project.
- To use **another repo** as the project: run from the umwelten repo and pass `--project /path/to/other/repo`; you never need to `cd` into the other repo to run the CLI.

### 4.1 Start local mode from inside a repo

From the umwelten repo (cwd = managed project):

```bash
pnpm run cli habitat local -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] Current directory is treated as the managed project
- [ ] No clone is created
- [ ] A managed agent record is created or reused
- [ ] A `MEMORY.md` file is created in the project (or at the configured memory path)
- [ ] The session opens directly on the project sub-agent
- [ ] Asking "what does this project do?" uses repo context
- [ ] Asking the local sub-agent to run a project script does not recurse through `agent_ask`
- [ ] If the project is a git repo with `origin`, the registered agent captures `gitRemote` so bridge execution is available

### 4.2 One-shot local mode

From the umwelten repo:

```bash
pnpm run cli habitat local -p minimax -m MiniMax-M2.5 "what files are important here?"
```

Verify:

- [ ] One-shot output works without entering REPL mode
- [ ] Session metadata is still created correctly

### 4.3 Re-run / idempotence

Run the same command twice (from umwelten repo):

```bash
pnpm run cli habitat local -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] Existing agent registration is reused
- [ ] Duplicate agents are not created for the same project path

### 4.4 Explicit project path

Run from umwelten repo, attach a different project:

```bash
pnpm run cli habitat local --project /path/to/a/real/project -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `--project` overrides cwd
- [ ] The correct project is attached
- [ ] If the target repo has a git `origin`, the attached agent stores that remote in config

### 4.5 Alias command

From umwelten repo:

```bash
pnpm run cli habitat here -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `here` behaves the same as `local`

### 4.6 Skip configure

From umwelten repo:

```bash
pnpm run cli habitat local --skip-configure -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] The session still opens
- [ ] Automatic configure is skipped
- [ ] No unexpected memory/config write happens beyond registration

### 4.7 Local mode with a non-MiniMax provider

From umwelten repo:

```bash
pnpm run cli habitat local -p google -m gemini-3-flash-preview
```

Verify:

- [ ] The feature is not provider-specific
- [ ] Same flow works with another supported model provider

---

## 5. Habitat workspace-first registration / agent tools

Related commits: `04601f4`, `7b1daba`

### 5.1 Base Habitat REPL still works

```bash
pnpm run cli habitat -p google -m gemini-3-flash-preview
```

Verify:

- [ ] Habitat REPL starts normally
- [ ] Existing slash commands still work (`/agents`, `/tools`, `/context`, `/onboard`)

### 5.2 Agent registration behavior

In the Habitat REPL, use the agent-related workflows that now depend on workspace-first behavior.

Verify:

- [ ] Existing registered agents still show up
- [ ] Agent status/log lookups still work
- [ ] Prompt/memory loading for managed agents still works

### 5.3 Configure managed agent contract

Use either the tool flow or `habitat local` first-run flow on a real repo.

Verify:

- [ ] Setup/run commands inferred for the agent look reasonable
- [ ] Secrets refs are preserved or inferred correctly
- [ ] Log patterns are preserved or inferred correctly
- [ ] `MEMORY.md` content is written where expected

### 5.4 Session continuity

Open the same local agent multiple times.

Verify:

- [ ] The same session / agent memory behavior is preserved as expected
- [ ] The system does not lose track of the agent directory or memory path

---

## 6. Pairwise Elo ranking

Related commits: `5af8e03`, `109bcac`, `f9de636`

### 6.1 Unit tests

```bash
pnpm exec vitest run src/evaluation/ranking/ --reporter=verbose
```

Verify:

- [ ] All 21 tests pass (elo math + pairing strategies)
- [ ] No API keys or external services needed

### 6.2 Example script (requires API keys)

```bash
pnpm tsx examples/mcp-chat/elo-rivian.ts
```

Verify:

- [ ] Script runs with available provider keys
- [ ] Pairwise comparisons are executed and cached
- [ ] Final Elo standings are printed
- [ ] Re-running uses cached comparisons (faster second run)

### 6.3 API surface

```typescript
import { PairwiseRanker, expectedScore, updateElo, buildStandings, allPairs, swissPairs } from './src/evaluation/ranking';
```

Verify:

- [ ] All exports are accessible from `src/evaluation/ranking/index.ts`
- [ ] `evaluationResultsToRankingEntries()` bridge function works with evaluation output

---

## 7. TezLab MCP chat example

Related commit: `6130866`

### 7.1 First-run OAuth flow

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Browser-based OAuth starts
- [ ] Callback completes successfully
- [ ] TezLab tools are loaded after auth
- [ ] Auth/token storage is written outside the work directory as intended

### 7.2 Repeat launch with cached auth

Run again:

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] It reuses stored credentials if valid
- [ ] It does not unnecessarily force a new login

### 7.3 REPL commands

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

### 7.4 One-shot prompt mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts "Tell me the story of the last 10 days of my Tesla's activity."
```

Verify:

- [ ] One-shot prompt mode works
- [ ] MCP tools are actually invoked
- [ ] The command exits cleanly

### 7.5 Quiet mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --quiet "Summarize my recent Tesla activity"
```

Verify:

- [ ] Only final output is printed
- [ ] No strange streaming artifacts appear

### 7.6 Logout then re-auth

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --logout
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Logout actually clears stored credentials
- [ ] Next run requires auth again

---

## 8. Generic MCP CLI transport support

Related commit: `6130866`

### 8.1 Legacy stdio path

```bash
pnpm run cli mcp list
```

If you have a local MCP server, also exercise a stdio connection path.

Verify:

- [ ] Existing stdio-based MCP workflows still work

### 8.2 Remote transport argument parsing

Exercise the new CLI flags with a known endpoint or a deliberate bad URL:

```bash
pnpm run cli mcp connect --transport sse --url https://example.com
pnpm run cli mcp connect --transport websocket --url wss://example.com
```

Verify:

- [ ] `--transport` is accepted
- [ ] `--url` is accepted
- [ ] `-H/--header` parsing works
- [ ] Error messages are clean when the endpoint is invalid

### 8.3 Transport integration into Stimulus / quick connection paths

Verify manually through any existing MCP-backed flow you already trust.

- [ ] Remote transport config works where stdio-only config used to be assumed
- [ ] No regression in tool loading for MCP-backed sessions

---

## 9. Docs / examples smoke check

Related commits: `9c963e5`, `6130866`, `9310b11`, `04601f4`, `972c86e`, `f9de636`

Spot-check these files for copy/paste accuracy:

- [ ] `docs/index.md`
- [ ] `docs/guide/getting-started.md`
- [ ] `docs/api/cli.md`
- [ ] `docs/guide/model-discovery.md`
- [ ] `docs/guide/session-management.md`
- [ ] `docs/guide/habitat-agents.md`
- [ ] `docs/guide/mcp-chat.md`
- [ ] `docs/api/pairwise-ranking.md`
- [ ] `docs/examples/pairwise-ranking.md`
- [ ] `CHANGELOG.md`

Verify:

- [ ] Commands use `pnpm run cli ...` (no `dotenvx run --` prefix in user-facing docs)
- [ ] No stale `dotenvx run --` guidance remains in user-facing docs
- [ ] Local-agent examples match actual CLI behavior
- [ ] MCP chat docs match the current example behavior
- [ ] Pairwise ranking docs match the API and example code
- [ ] CHANGELOG 0.4.6 entry covers all features in this checklist

---

## Suggested Execution Order

If doing a quick but meaningful pass, do these first:

1. [ ] Run `pnpm test:run` — check no new failures
2. [ ] `.env` auto-loading from repo root (`pnpm run cli models`)
3. [ ] `models --provider minimax` — listing works
4. [ ] `models --provider google` — dates show "—" not "1/1/24"
5. [ ] One MiniMax prompt with `--stats` — verify token/cost reporting
6. [ ] MiniMax `chat` — verify streaming works (no TypeValidationError)
7. [ ] `habitat local` inside a real repo
8. [ ] TezLab MCP chat first-run auth and one-shot prompt
9. [ ] One stdio MCP regression check
10. [ ] Pairwise ranking unit tests

---

## Notes / Results

Use this section to record manual outcomes.

### Passed

- [ ]

### Failed / Needs Follow-up

- [ ]

### Oddities / Observations

- [ ]
