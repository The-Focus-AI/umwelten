# Dagger Logging: Why It Looked Broken

This note explains why `src/habitat/bridge/spikes/02-llm-container-build.ts` appeared to "not show logs" and what configuration makes logs visible in real time.

## What Happened

The spike was running Dagger operations, but terminal output looked stalled at:

- `Fetching model reply.`

and then returned later with little/no visible engine progress.

## Root Cause

Two separate behaviors were overlapping:

1. Dagger progress renderer mismatch in this terminal
   - Dagger's default progress UI can be non-streaming or hard to read in some terminal contexts.
   - In this mode, activity is happening, but the display can look quiet until steps complete.

2. `dag.llm().lastReply()` is one long operation
   - The call blocks until the LLM loop completes.
   - You do not get token-by-token text from `lastReply()` itself.
   - You only see operation progress if Dagger progress output is rendered clearly.

## Why `LogOutput` Alone Was Not Enough

`{ LogOutput: process.stderr }` was already correct, but it only routes Dagger logs to stderr.  
If the renderer format is not terminal-friendly, routed output can still appear unusable.

## What Fixed It

Force plain, line-by-line progress before connecting:

```ts
process.env.DAGGER_PROGRESS ??= "plain";
await connection(async () => {
  // dagger ops
}, { LogOutput: process.stderr });
```

With `DAGGER_PROGRESS=plain`, logs stream as incremental lines (connect, session, LLM query steps, exec output) while work is running.

## Important Observation From Live Logs

Once plain progress was enabled, logs showed that the run was not idle. The LLM loop was active, including repeated `LLM query` steps.

The logs also showed secret lookup errors like:

- `secret env var not found: "OPE..."`
- `secret env var not found: "GEM..."`
- `secret env var not found: "ANT..."`

This indicates missing provider credentials in the Dagger engine session for `dag.llm()`.

## Are We Using Dagger Correctly?

Mostly yes, with two caveats:

1. Connection/logging usage is correct now
   - `connection(..., { LogOutput: process.stderr })`
   - `DAGGER_PROGRESS=plain` for real-time logs in this environment

2. LLM execution prerequisites are not fully met
   - `dag.llm()` needs at least one configured provider credential available to the engine session.
   - Without credentials, LLM behavior is degraded (empty reply or failed attempts), even though the pipeline itself runs.

3. Verification check is currently misleading
   - Claude installer places binary under `~/.local/bin/claude` for the user it installs under.
   - `which claude` can report missing if PATH is not updated or install happened under a different user context.
   - A stronger check is to test both common locations plus PATH.

## Practical Recommendations

1. Keep `DAGGER_PROGRESS=plain` in spikes and debugging scripts.
2. Ensure provider secrets are set for the Dagger session before relying on `dag.llm()`.
3. For deterministic bridge builds, keep fallback builder path as the production-safe default.
4. Improve verification to check:
   - `which claude`
   - `/root/.local/bin/claude`
   - `/home/*/.local/bin/claude` (or use a known install user).
