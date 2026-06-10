/**
 * pi Runtime Runner (#122)
 *
 * Spawns the pi coding agent (`pi --mode json -p`) as an agentic subprocess
 * against an agent's project, translates its JSON-lines progress into bridge
 * events, and links the habitat session to pi's native session log via
 * nativeSessionRef — the pi peer of claude-sdk-runner.ts.
 *
 * Hard rule: no output-token caps anywhere in this runner.
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  BridgeEventHandlers,
  RuntimeContext,
  RuntimeResult,
  RuntimeRunner,
} from "./bridge/types.js";

export interface PiRunnerOptions {
  /** Working directory for pi (typically the agent's projectPath). */
  cwd: string;
  /** Extra env merged over process.env (PI_CODING_AGENT_DIR etc.). */
  env?: Record<string, string | undefined>;
  /** Callback for streaming progress updates. */
  onProgress?: (update: PiProgress) => void;
  /** pi binary name/path (default: "pi" on PATH). */
  binary?: string;
  /**
   * Injectable spawn for tests — lets unit tests drive the JSON-lines
   * loop (session-id extraction, event translation, error paths) with
   * the subprocess layer stubbed.
   */
  spawnFn?: typeof spawn;
}

export interface PiProgress {
  type: "text" | "reasoning" | "tool_use" | "tool_result" | "status";
  content: string;
  toolName?: string;
  input?: unknown;
  isError?: boolean;
}

export interface PiRunResult {
  /** Final assistant text. */
  content: string;
  /** Whether the run completed successfully (exit 0). */
  success: boolean;
  /** Error details when success is false. */
  errors: string[];
  /** pi's native session id, from the stream's `session` event. */
  sessionId?: string;
  /** Absolute path to pi's native session JSONL, when a session was seen. */
  sessionPath?: string;
}

// ── Native session location (PRD #113 co-location) ───────────────────

/**
 * pi's project-directory encoding for global session storage:
 * `--` + cwd with slashes dashed + `--` (the core PiAdapter decodes the
 * same convention at read time).
 */
export function piProjectDirName(cwd: string): string {
  const normalized = cwd.replace(/\/$/, "");
  return "--" + normalized.replace(/\//g, "-").replace(/^-/, "") + "--";
}

/** pi session file name: `<timestamp with [:.]→"-">_<sessionId>.jsonl`. */
export function piSessionFileName(
  timestampIso: string,
  sessionId: string,
): string {
  return `${timestampIso.replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
}

/**
 * Where pi wrote the native session JSONL for a run.
 *
 * - `PI_CODING_AGENT_SESSION_DIR` (pi's --session-dir equivalent) wins and
 *   is flat — files land directly in it.
 * - Otherwise `$PI_CODING_AGENT_DIR/sessions/<encoded-cwd>/`, falling back
 *   to `~/.pi/agent/sessions/<encoded-cwd>/`.
 *
 * The container image sets the env override beneath the data volume
 * (same posture as CLAUDE_CONFIG_DIR for claude-sdk); this helper only
 * reads the environment — runners never invent paths.
 */
export function piNativeSessionPath(
  cwd: string,
  sessionId: string,
  timestampIso: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const file = piSessionFileName(timestampIso, sessionId);
  const sessionDirOverride = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDirOverride) return join(sessionDirOverride, file);
  const agentDir =
    env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions", piProjectDirName(cwd), file);
}

// ── JSON-lines event translation ──────────────────────────────────────

function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

interface PiStreamState {
  sessionId?: string;
  sessionTimestamp?: string;
  finalText: string;
}

/**
 * Handle one parsed pi JSON event. Exported shape is internal to the
 * runner; kept as a function so the line loop stays trivial.
 */
function handleEvent(
  event: Record<string, unknown>,
  state: PiStreamState,
  onProgress?: (update: PiProgress) => void,
): void {
  switch (event.type) {
    case "session": {
      if (typeof event.id === "string") state.sessionId = event.id;
      if (typeof event.timestamp === "string")
        state.sessionTimestamp = event.timestamp;
      break;
    }
    case "message_update": {
      const ev = event.assistantMessageEvent as
        | { type?: string; delta?: string }
        | undefined;
      if (!ev) break;
      if (ev.type === "text_delta" && typeof ev.delta === "string") {
        onProgress?.({ type: "text", content: ev.delta });
      } else if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
        onProgress?.({ type: "reasoning", content: ev.delta });
      }
      break;
    }
    case "tool_execution_start": {
      const toolName =
        typeof event.toolName === "string" ? event.toolName : "tool";
      onProgress?.({
        type: "tool_use",
        content: `Using ${toolName}`,
        toolName,
        input: event.args,
      });
      break;
    }
    case "tool_execution_end": {
      const toolName =
        typeof event.toolName === "string" ? event.toolName : "tool";
      const result = event.result as { content?: unknown } | undefined;
      onProgress?.({
        type: "tool_result",
        content: textFromBlocks(result?.content),
        toolName,
        isError: event.isError === true,
      });
      break;
    }
    case "message_end": {
      const message = event.message as
        | { role?: string; content?: unknown }
        | undefined;
      if (message?.role === "assistant") {
        const text = textFromBlocks(message.content);
        if (text) state.finalText = text;
      }
      break;
    }
  }
}

// ── Runner ────────────────────────────────────────────────────────────

/**
 * Run a prompt through pi in non-interactive JSON mode.
 * Resolves on process exit — missing binary and non-zero exits resolve to
 * `{ success: false, errors: [...] }` rather than throwing or hanging.
 */
export function runPi(
  prompt: string,
  options: PiRunnerOptions,
): Promise<PiRunResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const binary = options.binary ?? "pi";
  // --no-extensions / --no-skills keep subprocess startup deterministic;
  // provider/model resolution stays with pi's own settings and env.
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-extensions",
    "--no-skills",
    prompt,
  ];

  return new Promise((resolve) => {
    const state: PiStreamState = { finalText: "" };
    let stdoutBuffer = "";
    let stderrTail = "";

    const proc = spawnFn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      // stdin MUST be ignored: with a piped stdin, pi waits for EOF before
      // processing the prompt and the run hangs forever (observed live).
      stdio: ["ignore", "pipe", "pipe"],
    });

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return; // startup warnings etc.
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        handleEvent(event, state, options.onProgress);
      } catch {
        /* partial or non-JSON line — ignore */
      }
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let idx = stdoutBuffer.indexOf("\n");
      while (idx !== -1) {
        consumeLine(stdoutBuffer.slice(0, idx));
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        idx = stdoutBuffer.indexOf("\n");
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    const finish = (success: boolean, errors: string[]) => {
      const env = { ...process.env, ...options.env };
      resolve({
        content: state.finalText,
        success,
        errors,
        sessionId: state.sessionId,
        sessionPath:
          state.sessionId && state.sessionTimestamp
            ? piNativeSessionPath(
                options.cwd,
                state.sessionId,
                state.sessionTimestamp,
                env,
              )
            : undefined,
      });
    };

    proc.on("error", (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === "ENOENT"
          ? `pi binary "${binary}" not found on PATH — install the pi coding agent (npm i -g @earendil-works/pi) or bake it into the container image.`
          : `Failed to spawn pi: ${err.message}`;
      finish(false, [hint]);
    });

    proc.on("close", (code: number | null) => {
      if (stdoutBuffer) consumeLine(stdoutBuffer);
      if (code === 0) {
        finish(true, []);
      } else {
        const errors = [
          `pi exited with code ${code ?? "null"}${stderrTail ? `: ${stderrTail.trim()}` : ""}`,
        ];
        finish(false, errors);
      }
    });
  });
}

// ── RuntimeRunner adapter ─────────────────────────────────────────────

/**
 * Adapt pi to the bridge's RuntimeRunner contract. Streams progress into
 * the bridge event handlers and, when pi reported a session, returns the
 * nativeSessionRef pointing at its JSONL trace (read at projection time
 * by the core PiAdapter per ADR 0001).
 *
 * `runFn` is injectable for tests; production uses runPi.
 */
export function createPiRuntimeRunner(
  runFn: typeof runPi = runPi,
): RuntimeRunner {
  return {
    async run(
      prompt: string,
      ctx: RuntimeContext,
      events: BridgeEventHandlers,
    ): Promise<RuntimeResult> {
      const result = await runFn(prompt, {
        cwd: ctx.agent.projectPath,
        onProgress: (update) => {
          if (update.type === "text") {
            events.onText?.(update.content);
          } else if (update.type === "reasoning") {
            events.onReasoning?.(update.content);
          } else if (update.type === "tool_use" && update.toolName) {
            events.onToolCall?.(update.toolName, update.input);
          } else if (update.type === "tool_result" && update.toolName) {
            events.onToolResult?.(
              update.toolName,
              update.content,
              update.isError === true,
            );
          }
        },
      });

      return {
        content: result.content,
        success: result.success,
        errors: result.errors.length ? result.errors : undefined,
        nativeSessionRef:
          result.sessionId && result.sessionPath
            ? {
                runtime: "pi",
                nativeSessionId: result.sessionId,
                nativeSessionPath: result.sessionPath,
              }
            : undefined,
      };
    },
  };
}
