# weird CLI

Convert “weird” CSV files into runnable TypeScript MCP servers.

## Install & Run

- Ensure Node 22+, pnpm, and GOOGLE_API_KEY in `.env`.

```bash
pnpm --filter @umwelten/weird dev
```

## Commands

- `weird preview <file.csv>`: Show encoding, delimiter, header/data indices (optional), and sample rows.
- `weird analyze <file.csv>`: Guided REPL to infer ParsingSpec and DomainSpec and generate an MCP project.
- `weird doctor`: Check environment.
- `weird version`: via `--version`.

## Env

- `GOOGLE_API_KEY` (required)
- `WEIRD_HEAD_ROWS` (default 25)
- `WEIRD_RANDOM_ROWS` (default 75)
- `WEIRD_SAMPLE_CAP` (default 200)
- `WEIRD_SAMPLE_SEED` (default 42)
- `WEIRD_MODEL` (default `gemini-2.5-pro-latest`)