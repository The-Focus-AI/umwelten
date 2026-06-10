# pi runtime runner — research (issue #122)

Date: 2026-06-10. Scope: implement the `pi` RuntimeRunner for habitat channels.
Research was done against the locally installed pi
(`@earendil-works/pi-coding-agent` 0.75.5) by running it in `--mode json` and
reading its dist sources — these are observed facts, not docs paraphrase.

## pi CLI invocation

- `pi --mode json -p "<prompt>"` — non-interactive, JSON-lines events on stdout.
- Positional args are the message; `--no-extensions --no-skills` keep startup
  lean and deterministic for subprocess use.
- pi resolves provider/model from its own settings/env — the runner passes
  nothing model-related and **no token caps** (hard rule).

## JSON event stream (observed)

One JSON object per stdout line:

- `{"type":"session","version":3,"id":"<uuidv7>","timestamp":"<ISO>","cwd":"<abs>"}` —
  **first line**; carries the native session id.
- `agent_start`, `turn_start`, `turn_end`, `agent_end` (final `messages` array).
- `message_start` / `message_end` with `message.role` `user` | `assistant` |
  `toolResult`. Assistant content blocks: `{type:"thinking"|"text"|"toolCall",...}`.
- `message_update` with `assistantMessageEvent.type` ∈ `thinking_start`,
  `thinking_delta` (`.delta`), `thinking_end`, `text_start`, `text_delta`
  (`.delta`), `text_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`
  (`.toolCall {id,name,arguments}`).
- `tool_execution_start` `{toolCallId, toolName, args}` and
  `tool_execution_end` `{toolCallId, toolName, result:{content:[{type:"text",text}]}, isError}`.

Final assistant text: join the `text` blocks of the last assistant
`message_end` (or `agent_end.messages`).

## Session storage (observed + dist/config.js)

- Default: `~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl`.
- `PI_CODING_AGENT_DIR` (config.js `ENV_AGENT_DIR`) overrides the agent dir →
  sessions at `$PI_CODING_AGENT_DIR/sessions/<encoded-cwd>/<file>.jsonl`.
  **Verified live**: file landed under the override.
- `PI_CODING_AGENT_SESSION_DIR` (`ENV_SESSION_DIR`, main.js:431) overrides the
  sessions dir directly, equivalent to `--session-dir` — **flat**, no
  encoded-cwd subdir (verified live with `--session-dir`).
- Encoded cwd: `"--" + cwd.replace(/\//g,"-").replace(/^-/,"") + "--"` — same
  convention the core `PiAdapter` already decodes (pi-adapter.ts).
- File name: `<timestamp ISO with [:.]→"-">_<sessionId>.jsonl`, e.g.
  `2026-06-10T19-10-26-843Z_019eb2f1-6c1b-7188-8978-6ce07381931d.jsonl`
  (timestamp = the `session` event's `timestamp`).

Per PRD #113 the container image sets the env override (same posture as
`CLAUDE_CONFIG_DIR` for claude-sdk in #127); the runner only reads env.

## RuntimeRunner seam (#127, merged)

- Contracts: `packages/habitat/src/bridge/types.ts` — `RuntimeRunner.run(prompt, ctx, events)`,
  `RuntimeContext {agent, sessionId, sessionDir, channelKey}`,
  `RuntimeResult {content, success, errors?, nativeSessionRef?}`,
  `BridgeEventHandlers {onText?, onReasoning?, onToolCall?, onToolResult?, onDone, onError?}`.
- Bridge: `channel-bridge.ts` `handleRuntime()` — writes the envelope pair,
  persists `nativeSessionRef` into meta.json, clean error for unregistered
  runtimes. `ChannelRuntimeMode` already includes `'pi'`; routing.ts already
  whitelists it.
- Registration: `container-server.ts:185` `runtimeRunners: { 'claude-sdk': createClaudeSdkRuntimeRunner() }`.
- Prior art to mirror: `claude-sdk-runner.ts` (`runClaudeSDK` + injectable
  `queryFn`, `claudeNativeSessionPath(env)`, `createClaudeSdkRuntimeRunner`)
  and its tests `claude-sdk-runner.test.ts` (stubbed stream generator) and
  `bridge/channel-bridge-runtime.test.ts` (bridge-level dispatch fixtures).

## Design

`packages/habitat/src/pi-runner.ts`:
- `runPi(prompt, {cwd, env?, onProgress?, spawnFn?, binary?})` — spawns
  `pi --mode json -p --no-extensions --no-skills <prompt>`, line-buffers
  stdout, maps events → progress callbacks, collects stderr.
- Pure helpers `piProjectDirName`, `piSessionFileName`,
  `piNativeSessionPath(cwd, sessionId, timestamp, env)` honoring both env
  overrides.
- `createPiRuntimeRunner(runFn = runPi)` → RuntimeRunner; nativeSessionRef
  `{runtime:'pi', nativeSessionId, nativeSessionPath}`.
- Missing binary (spawn ENOENT) and non-zero exit resolve to
  `{success:false, errors:[clear message]}` — never hang, never throw raw.
- Register `pi: createPiRuntimeRunner()` in container-server.ts.
