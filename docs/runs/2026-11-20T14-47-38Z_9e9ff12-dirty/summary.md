# Verification Run Summary — `2026-11-20T14-47-38Z_9e9ff12-dirty`

- **Timestamp (UTC)**: `2026-11-20T14:47:38Z`
- **Git Head**: `9e9ff12-dirty`
- **Scope**: `--all` (`3` external standards, `7` conceptual spec packs, `38` active rules)
- **Mode**: Passive static/boundary checks + isolated `mktemp -d` SQLite, HTTP/A2A, and cold-rebuild portability drills

## Verdict Breakdown

| Pack | Version | Pass | Fail | Inconclusive | Waived |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `standards/per-speaker-agent-identity` | 1 | 2 | 0 | 0 | 0 |
| `standards/portable-agent-skills` | 1 | 2 | 0 | 0 | 0 |
| `standards/uncapped-benchmark-generation` | 1 | 2 | 0 | 0 | 0 |
| `foundation/pi-model-runtime` | 1 | 5 | 0 | 0 | 0 |
| `foundation/substrate-composition` | 1 | 4 | 0 | 0 | 0 |
| `orchestration/durable-habitats` | 1 | 5 | 0 | 0 | 0 |
| `orchestration/explorations-and-reflection` | 1 | 5 | 0 | 0 | 0 |
| `orchestration/evaluation-and-ranking` | 1 | 4 | 0 | 0 | 0 |
| `exchange/mycel-and-suppliers` | 1 | 5 | 0 | 0 | 0 |
| `interfaces/protocols-and-extensions` | 1 | 4 | 0 | 0 | 0 |
| **Total** | — | **38** | **0** | **0** | **0** |

## Executed Gates

- `pnpm run specs:check` — **PASS** (`3 standards, 7 specs, 38 effective rules, 7 decisions, 1 run`)
- Cold-rebuild portability drill (`mktemp -d` containing only `.agents/skills/` + `docs/`) — **PASS**
- `pnpm test:run` — **PASS** (`277` test files, `3,411` unit tests)
- `pnpm typecheck` — **PASS** (`13` workspace `tsconfig.json` projects + `examples/tsconfig.json`)
- `pnpm lint` — **PASS** (`0` errors)
- `pnpm -r build` & binary smoke checks (`node packages/umwelten/dist/cli/entry.js --help`, `node packages/mycel/dist/mycel.js --help`) — **PASS**
