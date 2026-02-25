# Bridge Spikes

Standalone scripts to validate each step of the bridge container build process.
Run them directly to isolate failures.

## Scripts

| # | Script | What it tests |
|---|--------|---------------|
| 01 | `01-git-clone.ts` | Dagger can clone a git repo and list files |
| 02 | `02-llm-container-build.ts` | `buildContainerWithLLM()` produces a valid container with tools installed |
| 04 | `04-service-startup.ts` | Full pipeline: build → service.up → MCP health check |
| 05 | `05-llm-simple-repo.ts` | dag.llm() works at all (minimal repo, simplest possible test) |
| 07 | `07-agent-install-llm.ts` | Focused LLM agent install + MCP startup/connect |
| 08 | `08-agent-rebuild-cache.ts` | Run two LLM builds and compare cache/rebuild speed |
| 09 | `09-fast-startup.ts` | Single-script LLM build + startup with cache-friendly repeat runs |

## Usage

```bash
# Start simple — test dag.llm() with a tiny repo
npx tsx src/habitat/bridge/spikes/05-llm-simple-repo.ts

# Test git clone
npx tsx src/habitat/bridge/spikes/01-git-clone.ts

# Test LLM build with real repo
npx tsx src/habitat/bridge/spikes/02-llm-container-build.ts

# Test full service startup
npx tsx src/habitat/bridge/spikes/04-service-startup.ts

# Test focused LLM build + validation only
dotenvx run -- npx tsx src/habitat/bridge/spikes/07-agent-install-llm.ts

# Test rebuild speed/cache behavior (same build twice)
dotenvx run -- npx tsx src/habitat/bridge/spikes/08-agent-rebuild-cache.ts

# Single-script "fast startup" flow
dotenvx run -- npx tsx src/habitat/bridge/spikes/09-fast-startup.ts

# Use a different repo
npx tsx src/habitat/bridge/spikes/02-llm-container-build.ts https://github.com/some/repo
```

## Recommended order

Start with `05` (simplest dag.llm() test), then `01`, then `02`, then `04`.
If `05` fails, the problem is with dag.llm() itself.
If `02` fails but `05` works, the problem is with the prompt or the real repo.
If `04` fails but `02` works, the problem is with service.up() or port binding.
