# Testing Checklist

Manual verification checklist for the recent changes on `main`.

## Scope

This checklist covers all notable commits on `main` through `2a7a60f`:

**Features:**
- `7b1daba` — Refactor habitat agents around workspace-first registration
- `6130866` — feat(mcp): add TezLab chat example and remote transport support
- `9c963e5` — chore(env): auto-load `.env` for CLI and tests
- `9310b11` — Add MiniMax provider support and refresh docs
- `04601f4` — Add local workspace Habitat agents
- `5af8e03` — feat(evaluation): add pairwise Elo ranking module
- `3621ad4` — feat(providers): add DeepInfra and Together AI providers
- `b57e08b` — feat(cognition): unified reasoning effort across providers
- `576909f` — feat(habitat): self-modify tools for runtime tool/skill creation
- `1211cf4` — feat(tools): add headers, method, body to wget tool
- `c573abd` — feat(telegram): vision model, session resume, formatting improvements

**Bug fixes:**
- `233fafa` — fix(cognition): normalize input/output token usage for costs
- `09e9aea` — fix(cli): strip leading `--`, improve model listing errors, fix date display
- `7620d4a` — fix(google): stop using fake addedDate for models
- `aea6631` — fix(run): reliable usage/cost and stats; add `--debug-usage`
- `4edb489` — fix(minimax): normalize streaming delta.role so chat works with AI SDK
- `9372bac` — fix(habitat): sub-agent tool denylist and git remote inference
- `8b76ae6` — fix(providers): resilient model validation and OpenRouter error handling

**Docs / chores:**
- `972c86e` — docs: remove dotenvx prefix from CLI examples
- `996adb6` — docs: add CHANGELOG.md
- `c448d5d` — chore: bump version to 0.4.6
- `f9de636` — docs: add pairwise ranking documentation
- `ec82826` — feat(examples): add Rivian evaluation and report scripts
- `2a7a60f` — chore: update docs, tests, and eval model lists

---

## Test Environment Prerequisites

Before running the checklist, verify:

- [ ] Repository dependencies installed: `pnpm install`
- [ ] Root `.env` exists and contains the API keys you expect to use
- [ ] `MINIMAX_API_KEY` is set if testing MiniMax
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` or another provider key is set for Habitat / chat tests
- [ ] `DEEPINFRA_API_KEY` is set if testing DeepInfra
- [ ] `TOGETHER_API_KEY` is set if testing Together AI
- [ ] Docker / Dagger prerequisites are available if testing bridge spikes
- [ ] TezLab account/browser access is available if testing the MCP chat example
- [ ] You have at least one real local repo available to test `habitat local`
- [ ] Telegram bot token available if testing Telegram features

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

Then run the ranking unit tests and self-modify tool tests (no API keys needed):

```bash
pnpm exec vitest run src/evaluation/ranking/ --reporter=verbose
pnpm exec vitest run src/habitat/tools/self-modify-tools.test.ts --reporter=verbose
```

### Manual / integration scripts (see also Examples index)

These are **not** part of `pnpm test:run`; use them when validating Dagger, tools, or streaming:

```bash
pnpm tsx src/test/test-dagger-runner.ts
pnpm tsx src/test/test-tool-conversations.ts
pnpm tsx src/test/test-reasoning-streaming-simple.ts
pnpm tsx src/test/test-reasoning-complex.ts
```

Optional **unused export / file** pass (noisy; deep imports and scripts are often flagged):

```bash
pnpm knip
```

`knip.json` scopes analysis to `src/` entrypoints (`cli/entry.ts`, `index.ts`, `habitat/bridge/server.ts`). Many hits are intentional library surface or test-only modules—triaging is manual.

Verify:

- [ ] Total test count is ~774+ passed
- [ ] Only pre-existing failures appear (Ollama text generation, OpenRouter auth, `src/memory/determine_operations` needing local models)
- [ ] No new failures in `src/cli/`, `src/cognition/`, `src/providers/minimax*`
- [ ] All 21 pairwise ranking tests pass (13 elo + 8 pairing)
- [ ] Self-modify tools tests pass

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
pnpm run cli models --provider deepinfra
pnpm run cli models --provider togetherai
```

Verify:

- [ ] Commands work without `dotenvx run --`
- [ ] Provider env vars are picked up automatically from `.env` (run from repo root so `.env` is found)
- [ ] No extra dotenv banner/noise appears in normal output
- [ ] If a provider shows 0 models, ensure its key is in repo-root `.env`

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

Related commits: `09e9aea`, `7620d4a`, `8b76ae6`

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

### 2.4 Resilient model validation

Related commit: `8b76ae6`

Model validation now falls through on network errors (timeouts) instead of blocking the request.

```bash
# If OpenRouter key is set, test that model listing doesn't crash on unexpected API responses
pnpm run cli models --provider openrouter
```

Verify:

- [ ] OpenRouter model listing doesn't crash on unexpected API shapes
- [ ] If a provider is temporarily unreachable, the CLI degrades gracefully (proceeds with the request rather than failing at validation)

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

## 4. DeepInfra and Together AI providers

Related commit: `3621ad4`

### 4.1 Model listing

```bash
pnpm run cli models --provider deepinfra
pnpm run cli models --provider togetherai
```

Verify:

- [ ] DeepInfra models are listed (requires `DEEPINFRA_API_KEY`)
- [ ] Together AI models are listed (requires `TOGETHER_API_KEY`)
- [ ] Model names, context lengths, and pricing look sane
- [ ] Both providers appear in `pnpm run cli models` (all-provider listing)

### 4.2 Basic prompt with each provider

```bash
pnpm run cli run --provider deepinfra --model meta-llama/Llama-4-Scout-17B-16E-Instruct --stats "Say hello in one sentence."
pnpm run cli run --provider togetherai --model meta-llama/Llama-4-Scout-17B-16E-Instruct --stats "Say hello in one sentence."
```

Verify:

- [ ] Requests succeed
- [ ] `--stats` shows token counts and cost
- [ ] Response content is returned normally

### 4.3 Reasoning effort support

Both providers support `reasoning_effort` via the unified reasoning effort system.

```bash
pnpm run cli run --provider deepinfra --model meta-llama/Llama-4-Scout-17B-16E-Instruct "Explain quantum computing briefly."
```

Verify:

- [ ] No errors when reasoning effort options are passed through

---

## 5. Unified reasoning effort

Related commit: `b57e08b`

`ReasoningEffort` (none/low/medium/high) is now a first-class option on `ModelRoute`, translated to provider-specific settings automatically.

### 5.1 Google reasoning

```bash
pnpm run cli run --provider google --model gemini-3-flash-preview "What is 15 factorial?"
```

Verify:

- [ ] Google models use `thinkingConfig` under the hood (no manual provider options needed)
- [ ] No errors from reasoning configuration

### 5.2 Cross-provider consistency

Try the same prompt across providers that support reasoning:

```bash
pnpm run cli run --provider google --model gemini-3-flash-preview --stats "Plan a 3-day trip to Tokyo"
pnpm run cli run --provider minimax --model MiniMax-M2.5 --stats "Plan a 3-day trip to Tokyo"
```

Verify:

- [ ] Both complete without errors
- [ ] No provider-specific reasoning configuration leaks into other providers

---

## 6. Local workspace Habitat agents

Related commits: `04601f4`, `9372bac`

This is one of the highest-risk areas because it changes how users can attach directly to a repo-local sub-agent.

**Directory setup:** The CLI must be run from the **umwelten repo** (so `pnpm run cli` works). The **managed project** is either (1) the current working directory when you run the command, or (2) the path you pass with `--project`.

### 6.1 Start local mode from inside a repo

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
- [ ] If the project is a git repo with `origin`, the registered agent captures `gitRemote` automatically (from `9372bac`)

### 6.2 Sub-agent tool denylist

Related commit: `9372bac`

Sub-agents should NOT have access to agent management tools that could cause recursive delegation.

Verify:

- [ ] Sub-agent does NOT have `agent_ask`, `agent_clone`, or other agent management tools
- [ ] Asking the local sub-agent to delegate to another agent does not recurse
- [ ] Sub-agent still has file tools, time tools, and URL tools

### 6.3 One-shot local mode

From the umwelten repo:

```bash
pnpm run cli habitat local -p minimax -m MiniMax-M2.5 "what files are important here?"
```

Verify:

- [ ] One-shot output works without entering REPL mode
- [ ] Session metadata is still created correctly

### 6.4 Re-run / idempotence

Run the same command twice (from umwelten repo):

```bash
pnpm run cli habitat local -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] Existing agent registration is reused
- [ ] Duplicate agents are not created for the same project path

### 6.5 Explicit project path

Run from umwelten repo, attach a different project:

```bash
pnpm run cli habitat local --project /path/to/a/real/project -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `--project` overrides cwd
- [ ] The correct project is attached
- [ ] If the target repo has a git `origin`, the attached agent stores that remote in config

### 6.6 Alias command

From umwelten repo:

```bash
pnpm run cli habitat here -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] `here` behaves the same as `local`

### 6.7 Skip configure

From umwelten repo:

```bash
pnpm run cli habitat local --skip-configure -p minimax -m MiniMax-M2.5
```

Verify:

- [ ] The session still opens
- [ ] Automatic configure is skipped
- [ ] No unexpected memory/config write happens beyond registration

### 6.8 Local mode with a non-MiniMax provider

From umwelten repo:

```bash
pnpm run cli habitat local -p google -m gemini-3-flash-preview
```

Verify:

- [ ] The feature is not provider-specific
- [ ] Same flow works with another supported model provider

---

## 7. Habitat self-modify tools

Related commit: `576909f`

Agents can now create tools and skills at runtime. These tools are in `standardToolSets` so all habitats get them.

### 7.1 Unit tests

```bash
pnpm exec vitest run src/habitat/tools/self-modify-tools.test.ts --reporter=verbose
```

Verify:

- [ ] All self-modify tool tests pass

### 7.2 Runtime tool creation in REPL

In a Habitat REPL session:

```bash
pnpm run cli habitat -p google -m gemini-3-flash-preview
```

Ask the agent to create a custom tool (e.g., "create a tool that converts Celsius to Fahrenheit").

Verify:

- [ ] `create_tool` is available in `/tools` listing
- [ ] Agent can create a tool at runtime
- [ ] `list_custom_tools` shows the created tool
- [ ] `reload_tools` picks up the new tool
- [ ] The created tool is usable in subsequent prompts
- [ ] `remove_custom_tool` removes it

### 7.3 Runtime skill creation

Ask the agent to create a custom skill.

Verify:

- [ ] `create_skill` is available
- [ ] `reload_skills` picks up the new skill

---

## 8. Habitat workspace-first registration / agent tools

Related commits: `04601f4`, `7b1daba`

### 8.1 Base Habitat REPL still works

```bash
pnpm run cli habitat -p google -m gemini-3-flash-preview
```

Verify:

- [ ] Habitat REPL starts normally
- [ ] Existing slash commands still work (`/agents`, `/tools`, `/context`, `/onboard`)

### 8.2 Agent registration behavior

In the Habitat REPL, use the agent-related workflows that now depend on workspace-first behavior.

Verify:

- [ ] Existing registered agents still show up
- [ ] Agent status/log lookups still work
- [ ] Prompt/memory loading for managed agents still works

### 8.3 Configure managed agent contract

Use either the tool flow or `habitat local` first-run flow on a real repo.

Verify:

- [ ] Setup/run commands inferred for the agent look reasonable
- [ ] Secrets refs are preserved or inferred correctly
- [ ] Log patterns are preserved or inferred correctly
- [ ] `MEMORY.md` content is written where expected

### 8.4 Session continuity

Open the same local agent multiple times.

Verify:

- [ ] The same session / agent memory behavior is preserved as expected
- [ ] The system does not lose track of the agent directory or memory path

---

## 9. Enhanced wget tool

Related commit: `1211cf4`

The `wget` tool now accepts custom HTTP headers, method (GET/POST/PUT/PATCH/DELETE), and request body.

### 9.1 Basic fetch (regression)

In a Habitat REPL or chat session with URL tools available:

Verify:

- [ ] Basic URL fetching still works (no regression)
- [ ] `markify` and `parse_feed` tools still work

### 9.2 Custom headers and methods

Ask the agent to fetch a URL with custom headers, or use the tool directly:

Verify:

- [ ] `headers` parameter is accepted (object of key-value pairs)
- [ ] `method` parameter is accepted (GET/POST/PUT/PATCH/DELETE)
- [ ] `body` parameter is accepted for POST/PUT/PATCH
- [ ] Authenticated API calls work when headers include auth tokens

---

## 10. Telegram improvements

Related commit: `c573abd`

### 10.1 Vision model support

Verify:

- [ ] Separate `--vision-model` option is accepted
- [ ] Photo/video messages are routed to the vision model
- [ ] Falls back to main model if vision model is not specified

### 10.2 Session resume on restart

Verify:

- [ ] On bot restart, last 4 message pairs are loaded from transcript
- [ ] Conversation context is preserved across restarts
- [ ] Transcript persistence works even in error paths

### 10.3 Formatting improvements

Verify:

- [ ] Markdown tables are converted to vertical card layout for narrow Telegram screens
- [ ] Telegram-specific system instruction tells the model to avoid tables
- [ ] No rendering artifacts in messages

### 10.4 Stability

Verify:

- [ ] Unhandled rejection handler catches AI SDK stream teardown crashes
- [ ] Bot doesn't crash on stream errors

---

## 11. Pairwise Elo ranking

Related commits: `5af8e03`, `109bcac`, `f9de636`

### 11.1 Unit tests

```bash
pnpm exec vitest run src/evaluation/ranking/ --reporter=verbose
```

Verify:

- [ ] All 21 tests pass (elo math + pairing strategies)
- [ ] No API keys or external services needed

### 11.2 Example script (requires API keys)

```bash
pnpm tsx examples/mcp-chat/elo-rivian.ts
```

Verify:

- [ ] Script runs with available provider keys
- [ ] Pairwise comparisons are executed and cached
- [ ] Final Elo standings are printed
- [ ] Re-running uses cached comparisons (faster second run)

### 11.3 API surface

```typescript
import { PairwiseRanker, expectedScore, updateElo, buildStandings, allPairs, swissPairs } from './src/evaluation/ranking';
```

Verify:

- [ ] All exports are accessible from `src/evaluation/ranking/index.ts`
- [ ] `evaluationResultsToRankingEntries()` bridge function works with evaluation output

---

## 12. TezLab MCP chat example

Related commit: `6130866`

### 12.1 First-run OAuth flow

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Browser-based OAuth starts
- [ ] Callback completes successfully
- [ ] TezLab tools are loaded after auth
- [ ] Auth/token storage is written outside the work directory as intended

### 12.2 Repeat launch with cached auth

Run again:

```bash
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] It reuses stored credentials if valid
- [ ] It does not unnecessarily force a new login

### 12.3 REPL commands

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

### 12.4 One-shot prompt mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts "Tell me the story of the last 10 days of my Tesla's activity."
```

Verify:

- [ ] One-shot prompt mode works
- [ ] MCP tools are actually invoked
- [ ] The command exits cleanly

### 12.5 Quiet mode

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --quiet "Summarize my recent Tesla activity"
```

Verify:

- [ ] Only final output is printed
- [ ] No strange streaming artifacts appear

### 12.6 Logout then re-auth

```bash
pnpm exec tsx examples/mcp-chat/cli.ts --logout
pnpm exec tsx examples/mcp-chat/cli.ts
```

Verify:

- [ ] Logout actually clears stored credentials
- [ ] Next run requires auth again

---

## 13. Generic MCP CLI transport support

Related commit: `6130866`

### 13.1 Legacy stdio path

```bash
pnpm run cli mcp list
```

If you have a local MCP server, also exercise a stdio connection path.

Verify:

- [ ] Existing stdio-based MCP workflows still work

### 13.2 Remote transport argument parsing

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

### 13.3 Transport integration into Stimulus / quick connection paths

Verify manually through any existing MCP-backed flow you already trust.

- [ ] Remote transport config works where stdio-only config used to be assumed
- [ ] No regression in tool loading for MCP-backed sessions

---

## 14. Docs / examples smoke check

Related commits: `9c963e5`, `6130866`, `9310b11`, `04601f4`, `972c86e`, `f9de636`, `2a7a60f`

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
- [ ] `CLAUDE.md` (should mention DeepInfra and Together AI)

Verify:

- [ ] Commands use `pnpm run cli ...` (no `dotenvx run --` prefix in user-facing docs)
- [ ] No stale `dotenvx run --` guidance remains in user-facing docs
- [ ] Local-agent examples match actual CLI behavior
- [ ] MCP chat docs match the current example behavior
- [ ] Pairwise ranking docs match the API and example code
- [ ] CHANGELOG 0.4.6 entry covers all features in this checklist
- [ ] DeepInfra and Together AI are documented in CLAUDE.md provider list

---

## Suggested Execution Order

If doing a quick but meaningful pass, do these first:

1. [ ] Run `pnpm test:run` — check no new failures
2. [ ] `.env` auto-loading from repo root (`pnpm run cli models`)
3. [ ] `models --provider minimax` — listing works
4. [ ] `models --provider deepinfra` — new provider lists models
5. [ ] `models --provider togetherai` — new provider lists models
6. [ ] `models --provider google` — dates show "—" not "1/1/24"
7. [ ] One MiniMax prompt with `--stats` — verify token/cost reporting
8. [ ] MiniMax `chat` — verify streaming works (no TypeValidationError)
9. [ ] `habitat local` inside a real repo — verify sub-agent denylist
10. [ ] Self-modify tools unit tests pass
11. [ ] TezLab MCP chat first-run auth and one-shot prompt
12. [ ] One stdio MCP regression check
13. [ ] Pairwise ranking unit tests

---

## Notes / Results

Use this section to record manual outcomes.

### Passed

- [ ]

### Failed / Needs Follow-up

- [ ]

### Oddities / Observations

- [ ]
