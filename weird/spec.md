feature spec

0) Summary

A CLI tool, weird, that helps developers convert “weird” files (v1: CSV, 10–100 MB) into a runnable TypeScript MCP server that you can chat with.
The CLI runs an interactive, stepwise session that: (1) previews the file, (2) infers parsing & schema, (3) infers domain meaning and representative queries, and (4) generates a fresh MCP server project wired to load similar files and expose generic + domain-specific tools.
LLM: Gemini 2.5 Pro (latest). Config via .env only. SQLite is in-memory in the generated server. Errors fail fast.

⸻

1) Goals & Non-Goals

Goals
	•	Provide a guided REPL that produces a developer-ready MCP server for a given CSV.
	•	Produce deterministic, minimal ParsingSpec and light DomainSpec from LLM output.
	•	Generate both generic SQL/inspection tools and domain-specific helper tools.
	•	Keep v1 tight: CSV only, in-memory SQLite, manual pnpm install.

Non-Goals (v1)
	•	XLSX, Parquet, PCAP, binaries, etc.
	•	Automated dependency install in generated project.
	•	PII redaction, telemetry, or network retries.
	•	Tests in generated MCP projects (tests live in the generator only).

⸻

2) Target Users & Environment
	•	Users: developers needing quick analyzers for unfamiliar or messy CSVs.
	•	Platforms: Node.js 22, TypeScript 5 (ESM).
	•	Package managers: pnpm (both generator and generated project).
	•	OS: macOS/Linux/Windows (no native deps assumed beyond sqlite3 prebuilds).

⸻

3) High-Level Architecture

weird (CLI)
├─ Commands: analyze | preview | doctor | version
├─ REPL Flow (analyze)
│  1. Load & sample CSV
│  2. Detect header/data start
│  3. LLM: ParsingSpec JSON
│  4. Interactive edit/confirm ParsingSpec
│  5. Sample rows -> LLM: DomainSpec JSON
│  6. Interactive edit/confirm DomainSpec
│  7. Codegen -> fresh MCP server project
│  8. Print next steps (pnpm install; pnpm start)
│
├─ Core Modules
│  • csvSampler (papaparse, chardet, iconv-lite)
│  • headerDetector (late headers/preamble)
│  • llmClient (Gemini 2.5 Pro)
│  • specValidator (zod/JSON schema; fail fast)
│  • codegen (handlebars/templates)
│  • repl (prompts)
│
└─ Templates
   • ts MCP server boilerplate
   • tools: generic + domain
   • README, tsconfig, package.json


⸻

4) Dependencies

Generator (CLI):
	•	CLI: commander, prompts, chalk
	•	CSV: papaparse, chardet, iconv-lite
	•	LLM: @google/generative-ai (Gemini 2.5 Pro)
	•	Validation: zod
	•	Codegen: handlebars
	•	Env: dotenv
	•	Build/dev: tsx, tsup
	•	Tests (generator only): vitest, ts-node (if needed)

Generated MCP server:
	•	MCP: @modelcontextprotocol/sdk
	•	DB: sqlite3 (Node binding), better-sqlite3 not used in v1
	•	Dev/runtime: tsx
	•	Types: typescript

⸻

5) Configuration
	•	.env in the CLI project root (read via dotenv):
	•	GOOGLE_API_KEY=<required>
	•	Optional knobs (with CLI defaults):
	•	WEIRD_HEAD_ROWS=25
	•	WEIRD_RANDOM_ROWS=75
	•	WEIRD_SAMPLE_CAP=200
	•	WEIRD_SAMPLE_SEED=42
	•	WEIRD_MODEL=gemini-2.5-pro-latest
	•	No global config; no home-dir files in v1.

⸻

6) CLI Surface

Binary

weird

Commands
	•	weird analyze <path/to/file.csv>
	•	Stepwise REPL; generates a new project folder.
	•	Flags:
	•	--project-name <name> (default: derived from file stem)
	•	--head <n> (default 25)
	•	--random <n> (default 75)
	•	--seed <int> (default 42)
	•	--cap <n> (default 200)
	•	--model <id> (default gemini-2.5-pro-latest)
	•	--out <dir> (default ./generated/<name>)
	•	--no-write (dry run; show preview/specs only)
	•	weird preview <path/to/file.csv>
	•	Show delimiter guess, header/data indices, schema guess (local heuristics only), and first N rows.
	•	Flags: --rows <n> (default 20), --detect-headers
	•	weird doctor
	•	Check Node version, pnpm, presence of .env and GOOGLE_API_KEY.
	•	weird version
	•	Print CLI version.

Exit codes: 0 success; 1 invalid input; 2 LLM/spec validation failure; 3 codegen failure.

⸻

7) Interactive “Analyze” Flow (Stepwise, Always Confirm)
	1.	Load + Sample

	•	Detect encoding with chardet; decode with iconv-lite.
	•	Parse a small buffer (~200 KB or up to 300 lines) to sniff delimiter from the set: , ; \t |.
	•	Parse entire file in memory with PapaParse using detected options.
	•	Sampling policy for LLM: head=25 + random=75, cap 200, seed 42.

	2.	Header & Data Start Detection (late headers/preamble)

	•	For each line i:
	•	col_count[i] from delimiter split.
	•	string_ratio[i] = % cells that aren’t numeric-like.
	•	Find first window of K=5 consecutive lines with stable col_count (stdev 0).
	•	Propose data_start_row_index = startOfWindow.
	•	If the previous line has same col_count, higher string_ratio, and values look like short tokens (≤32 chars, mostly unique), propose it as header_row_index; else set header_row_index = data_start_row_index and has_header=false.
	•	If ambiguity (multiple windows within ±2 lines): ask LLM (provide ~20 lines around boundary) for two integers only: header_row_index and data_start_row_index.
	•	Show preview with the proposed indices; user must confirm or edit.

	3.	ParsingSpec Inference (LLM)

	•	Send:
	•	the confirmed header/data indices,
	•	delimiter/encoding,
	•	sampled rows (head+random; capped),
	•	instruction to output strict JSON only (no prose).
	•	ParsingSpec (minimal):

{
  "format": "csv",
  "encoding": "utf-8",
  "delimiter": ",",
  "has_header": true,
  "header_row_index": 0,
  "data_start_row_index": 1,
  "null_tokens": ["", "NULL"],
  "columns": [
    { "name": "col1", "type": "string" }
  ]
}

	•	Allowed type: "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json".
	•	Map to SQLite:
	•	string,json -> TEXT
	•	integer -> INTEGER
	•	float -> REAL
	•	boolean -> INTEGER (0/1)
	•	date,datetime -> TEXT (ISO 8601)
	•	Validate with zod; on error → fail fast with message.
	•	Interactive editor: render columns, let user rename & change types; confirm.

	4.	DomainSpec Inference (LLM)

	•	Send:
	•	confirmed ParsingSpec,
	•	the same sampled rows,
	•	ask for lightweight JSON only.
	•	DomainSpec (lean):

{
  "table_name": "derived_from_filename",
  "primary_key": [],
  "time_fields": [],
  "dimensions": [],
  "measures": [],
  "faq_queries": [
    { "name": "row_count", "sql": "SELECT COUNT(*) AS rows FROM {{table}};" }
  ]
}

	•	primary_key: optional string array (user may set).
	•	time_fields: column names likely to be dates/datetimes.
	•	dimensions: categorical/text columns.
	•	measures: numeric columns likely of analytical interest.
	•	faq_queries: minimal starter SQL with {{table}} placeholder.
	•	Validate; show in REPL for edits; require explicit confirmation.

	5.	Code Generation

	•	Always create new project folder: ./generated/mcp-<project-name>/.
	•	Scaffold files (see §9).
	•	Print next steps:
	1.	cd generated/mcp-<name>
	2.	pnpm install
	3.	pnpm start

⸻

8) Data Handling
	•	Memory Model: Entire CSV loaded into memory for v1 (10–100 MB target).
	•	Normalization:
	•	Apply null_tokens → null.
	•	Coerce per-column type during ingestion into SQLite:
	•	integer/float: JS Number(...), invalid → null.
	•	boolean: case-insensitive true/1/yes/y → 1, false/0/no/n → 0; else null.
	•	date/datetime: try Date.parse; if valid → ISO string; else raw → null.
	•	json: JSON.parse try/catch; if fail → null.
	•	SQLite: In generated server, create an in-memory DB; create a single table named after DomainSpec.table_name (or file stem). Insert rows in batches (e.g., 1k).

⸻

9) Generated Project Layout

mcp-<project-name>/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ README.md
└─ src/
   ├─ server.ts               // MCP server bootstrap
   ├─ ingest/
   │   ├─ parsingSpec.json    // baked-in spec for this file type
   │   └─ ingestCsv.ts        // CSV -> SQLite (in-memory)
   ├─ db/
   │   └─ connection.ts       // open in-memory, helpers
   ├─ tools/
   │   ├─ generic.ts          // list_tables, describe_table, preview_rows, run_sql, export_results
   │   └─ domain.ts           // describe_domain, explain_field, suggest_queries, run_faq_query
   └─ llm/
       └─ client.ts           // Gemini 2.5 Pro calls (for suggest_* tools)

package.json (generated) (runnable with pnpm start):

{
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "sqlite3": "^5",
    "papaparse": "^5",
    "dotenv": "^16",
    "@google/generative-ai": "^0.21.0"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}


⸻

10) MCP Tools (generated)

Generic (available immediately)
	•	list_tables() → array of table names.
	•	describe_table(table) → columns with SQLite types, null counts (sampled quickly).
	•	preview_rows(table, limit=50, offset=0) → rows.
	•	run_sql(sql, params?) → read-only; reject statements that mutate (simple whitelist on SELECT).
	•	export_results(sql, format="csv"|"json", limit=10000) → returns serialized string or buffer.

Domain (derived from DomainSpec; some may call LLM at runtime)
	•	describe_domain() → returns DomainSpec.
	•	explain_field(column) → brief description; if not in spec, fallback to LLM guess over sample values.
	•	suggest_queries() → returns short list of parameterized SQL templates using dimensions/measures/time_fields.
	•	run_faq_query(name) → run SQL from faq_queries with {{table}} substituted.

Guardrails
	•	Read-only SQL only (reject INSERT/UPDATE/DELETE/CREATE/DROP).
	•	Row/byte limits with defaults: preview ≤ 1,000 rows; export ≤ 10,000 rows.
	•	Execution timeout (e.g., 5s) on queries.

⸻

11) LLM Prompts (deterministic, JSON-only)

11.1 Header/Data Start Tie-Breaker
	•	System: “You are a CSV structure detector. Output JSON with two integers only.”
	•	User content includes ~20 lines around boundary and delimiter.
	•	Required response schema:

{ "header_row_index": 8, "data_start_row_index": 9 }

11.2 ParsingSpec Prompt
	•	System: “Output only valid JSON matching the ParsingSpec schema. No prose.”
	•	User includes:
	•	detected delimiter/encoding,
	•	confirmed indices (or “unknown” if undecided),
	•	sampled rows (head+random),
	•	the allowed types & mapping rules.
	•	Response must match §7.3 schema exactly.

11.3 DomainSpec Prompt
	•	System: “Output only valid JSON matching the DomainSpec schema. No prose.”
	•	User includes ParsingSpec + sampled rows.
	•	Encourage small, useful faq_queries (2–5).

⸻

12) Code Generation Rules
	•	Use handlebars templates with pluggable helpers.
	•	Generation is idempotent into a new folder; generator never overwrites existing dirs.
	•	Inject ParsingSpec as JSON into src/ingest/parsingSpec.json.
	•	Generate a single ingest function that:
	1.	Reads the CSV with PapaParse per ParsingSpec.
	2.	Normalizes values per column type.
	3.	Creates SQLite table DDL from column list.
	4.	Bulk inserts in batches.
	•	Generate MCP server:
	•	Register generic tools from §10.
	•	Register domain tools using DomainSpec.
	•	pnpm start runs tsx src/server.ts.

⸻

13) Error Handling (Fail Fast)
	•	Input errors (file missing/unreadable, not CSV-ish):
	•	Print concise message; exit code 1.
	•	Inference errors (LLM failure, invalid JSON, schema mismatch):
	•	Print last prompt token count and LLM status; display raw LLM text.
	•	Exit code 2.
	•	Codegen errors (template failure, write permissions):
	•	Print file path and reason; exit code 3.
	•	No retries in v1. User can re-run the step/command.

⸻

14) Testing Plan (Generator Only)
	•	Unit tests (vitest):
	•	headerDetector (late headers): synthetic fixtures for preamble sizes 0, 3, 8, 20.
	•	delimiter sniffing: commas, tabs, pipes; mixed content.
	•	specValidator: valid/invalid ParsingSpec & DomainSpec shapes.
	•	type coercion: integer/float/boolean/date/datetime/json happy/sad paths.
	•	Integration tests:
	•	preview on sample CSVs (orders.csv, logs.csv).
	•	analyze --no-write: exercise LLM stubs/mocks to hit ParsingSpec/DomainSpec paths.
	•	codegen: generates a project; assert presence of files and compile with tsx (no runtime LLM calls).
	•	Fixtures:
	•	fixtures/orders_preamble8.csv (8 lines of header junk).
	•	fixtures/mixed_types.csv (numbers/booleans/dates).

⸻

15) Security & Privacy (v1 stance)
	•	No PII redaction or masking in prompts.
	•	No data is stored beyond the generated project; in-memory DB in the generated server.
	•	No telemetry/log shipping.

(Future work: optional redaction, on-disk DB option, and opt-in analytics.)

⸻

16) Performance & Limits
	•	CSV size: 10–100 MB target; fully in memory.
	•	Sampling to LLM: ≤ 200 rows; head/random as configured.
	•	Query timeouts in generated server: default 5s.
	•	LLM token limits respected by keeping prompts compact and JSON-only.

⸻

17) Acceptance Criteria
	•	weird preview <csv> prints delimiter, header row, data start, and shows first N rows.
	•	weird analyze <csv>:
	•	Guides through header/data detection; shows preview; requires confirmation.
	•	Produces ParsingSpec JSON and DomainSpec JSON from LLM; both are interactively editable and validated.
	•	Generates a fresh MCP project that:
	•	pnpm install && pnpm start runs an MCP server.
	•	On start, it ingests the original CSV (or any CSV matching the spec) into in-memory SQLite.
	•	Exposes generic MCP tools and domain tools per §10.
	•	Enforces read-only SQL and row limits.
	•	All generator tests pass locally via pnpm test.

⸻

18) Type Definitions (for the generator)

// ParsingSpec.ts
export type ScalarType =
  | "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json";

export interface ParsingSpec {
  format: "csv";
  encoding: string;           // e.g., "utf-8"
  delimiter: string;          // e.g., ","
  has_header: boolean;
  header_row_index: number;   // 0-based
  data_start_row_index: number;
  null_tokens: string[];
  columns: Array<{ name: string; type: ScalarType }>;
}

// DomainSpec.ts
export interface DomainSpec {
  table_name: string;
  primary_key: string[];      // optional in practice; default []
  time_fields: string[];      // subset of columns
  dimensions: string[];       // typically categorical
  measures: string[];         // typically numeric
  faq_queries: Array<{ name: string; sql: string }>;
}

Validation with zod mirrors the above.

⸻

19) Templates (outline)
	•	server.ts (MCP bootstrap)
	•	Reads .env (only for runtime LLM domain tools like suggest_queries).
	•	Starts MCP server; registers tools; logs ready.
	•	ingestCsv.ts
	•	Uses parsingSpec.json + PapaParse to parse and coerce rows.
	•	Creates SQLite in-memory DB and table; inserts rows in batches.
	•	tools/generic.ts
	•	Implements list/describe/preview/run_sql/export (read-only enforcement).
	•	tools/domain.ts
	•	Returns DomainSpec; implements explain_field, suggest_queries, run_faq_query.
	•	Uses Gemini client when needed (e.g., suggest_queries with few-shot context).
	•	llm/client.ts
	•	Thin wrapper around @google/generative-ai with model id from env or default.
	•	README.md
	•	How to run: pnpm install, pnpm start; how to point a client to MCP server.

⸻

20) Distribution
	•	CLI published as an npm package (name TBD) or used locally.
	•	Generated MCP project is self-contained and not published by default.

⸻

21) Next Steps (dev checklist)
	1.	Scaffold generator repo (apps/weird).
	2.	Implement preview (encoding/delimiter/header detector + table view).
	3.	Implement analyze REPL with ParsingSpec + DomainSpec prompts + validation.
	4.	Add codegen templates; wire to --out path (fresh dir only).
	5.	Add generator tests & fixtures; set up CI.
	6.	Manual QA on several CSVs incl. late headers and messy types.

⸻

Done. This spec is developer-ready for immediate implementation.
