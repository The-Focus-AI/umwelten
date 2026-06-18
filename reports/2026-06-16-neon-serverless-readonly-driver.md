# Read-Only Querying of Neon (Serverless Postgres) with `@neondatabase/serverless`

Research report (web-researcher subagent, 2026-06-16). Practical guidance for the
Twitter habitat feed-reader (issue #153): a long-lived fly.io container running
many small, parameterized, read-only `SELECT`s against Neon.

## 1. HTTP `neon()` vs `Pool`
Use **`neon()` (HTTP)**. Each query is a single stateless HTTPS fetch — no
connection pool, no cold-start handshake, no leaked connections. Connection
caching is always on since 0.9.0. `Pool`/WebSocket is only needed for interactive
transactions / sessions / `LISTEN`-`NOTIFY`, none of which a read-only feed reader
needs. Create one `const sql = neon(DATABASE_URL)` at module load and reuse it.

## 2. Parameterized queries
Two safe forms:
- Tagged template: `` sql`SELECT * FROM posts WHERE id = ${id}` `` (interpolations
  become `$1`-placeholders, never concatenated).
- `sql.query(text, params)` — `sql.query('... WHERE id = $1', [id])`. Added in
  v1.0.0. **This is the executor seam.**

`sql('string', [params])` (plain-function call with a string) was removed in 1.0.0
as injection-prone — it throws now. `sql.unsafe(str)` is only for trusted
identifiers (table/column names), never user input.

## 3. Read-only safety
Enforce outside the app: use a Postgres role granted only `SELECT`, and/or point
`DATABASE_URL` at a Neon **read replica** (rejects writes with SQLSTATE 25006).
Avoid `neondb_owner` (bypasses RLS). `sql.transaction([...], { readOnly: true })`
is a per-call extra but only applies to the transaction helper.

## 4. Error handling
HTTP path throws **`NeonDbError`** (exported). Branch on `.code` (Postgres
SQLSTATE — `42P01` undefined table, `25006` write-in-read-only) vs `.sourceError`
(connectivity, e.g. `fetch failed` TypeError → transient/retryable). Set a timeout
via `fetchOptions: { signal: AbortSignal.timeout(ms) }`.

## 5. Testability — inject a thin executor
```ts
export type QueryExecutor = <T = Record<string, unknown>>(
  text: string, params?: unknown[]
) => Promise<T[]>;

// prod:
const sql = neon(process.env.DATABASE_URL!);
const exec: QueryExecutor = (text, params) => sql.query(text, params);

// test: a fake that asserts on (text, params) and returns canned rows
```
Prefer the `(text, params)` seam over mocking the tagged template
(`TemplateStringsArray` is awkward to fake; the driver reduces the tag to
`query(text, params)` internally anyway). Inside the module still build queries
with `$1` placeholders + params array so user input never reaches SQL text.

## 6. 2024–2026 API caveats
- **1.0.0 (2025-03):** GA. `sql.query()` + `sql.unsafe()` added; string-call form
  removed; **Node ≥ 19 required**; `NeonDbError` captures stack traces.
- **1.1.0 (2026-04):** type declarations fully inlined.
- HTTP request/response capped at 64 MB — paginate large result sets.
- Repo already uses `neon()` (NeonStore) at `^1.1.0`, so `sql.query()` is present.

### References
Neon serverless-driver docs, GitHub README/CHANGELOG/CONFIG, Neon "SQL template
tags" blog, GitHub issues #51 (NeonDbError fields) and #146 (fetch failed), Neon
read-replica + database-access docs. Full URLs in the orchestrator transcript.
