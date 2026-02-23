# Bridge Spikes

Standalone scripts to validate each step of the bridge container build process.
Run them directly to isolate failures.

## Scripts

| # | Script | What it tests |
|---|--------|---------------|
| 01 | `01-git-clone.ts` | Dagger can clone a git repo and list files |
| 02 | `02-llm-container-build.ts` | `buildContainerWithLLM()` produces a valid container with tools installed |
| 03 | `03-fallback-container-build.ts` | Fallback heuristic build works |
| 04 | `04-service-startup.ts` | Full pipeline: build → service.up → MCP health check |
| 05 | `05-llm-simple-repo.ts` | dag.llm() works at all (minimal repo, simplest possible test) |
| 06 | `06-provision-and-connect.ts` | Deterministic provisioning (from spike 02) + MCP startup/connect |

## Usage

```bash
# Start simple — test dag.llm() with a tiny repo
npx tsx src/habitat/bridge/spikes/05-llm-simple-repo.ts

# Test git clone
npx tsx src/habitat/bridge/spikes/01-git-clone.ts

# Test LLM build with real repo
npx tsx src/habitat/bridge/spikes/02-llm-container-build.ts

# Test fallback build
npx tsx src/habitat/bridge/spikes/03-fallback-container-build.ts

# Test full service startup
npx tsx src/habitat/bridge/spikes/04-service-startup.ts

# Test deterministic provisioning + MCP connect
dotenvx run -- npx tsx src/habitat/bridge/spikes/06-provision-and-connect.ts

# Use a different repo
npx tsx src/habitat/bridge/spikes/02-llm-container-build.ts https://github.com/some/repo
```

## Recommended order

Start with `05` (simplest dag.llm() test), then `01`, then `02`/`03`, then `04`.
If `05` fails, the problem is with dag.llm() itself.
If `02` fails but `05` works, the problem is with the prompt or the real repo.
If `04` fails but `02` works, the problem is with service.up() or port binding.
