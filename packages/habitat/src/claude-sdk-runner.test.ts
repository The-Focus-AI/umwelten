/**
 * Unit tests for the claude-sdk runner's #118 surface: init-message
 * session-id extraction (subprocess stubbed via queryFn), native session
 * path computation, and the RuntimeRunner adapter.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  claudeAuthOptions,
  claudeNativeSessionPath,
  claudeProjectDirName,
  createClaudeSdkRuntimeRunner,
  runClaudeSDK,
  type ClaudeSDKResult,
} from "./claude-sdk-runner.js";
import type { RuntimeContext } from "./bridge/types.js";
import type { AgentEntry } from "./types.js";

// ── Stubbed SDK stream ────────────────────────────────────────────────

function makeQueryFn(messages: unknown[]): any {
  return () =>
    (async function* () {
      for (const m of messages) yield m;
    })();
}

const INIT_MESSAGE = {
  type: "system",
  subtype: "init",
  session_id: "sdk-sess-1234",
  cwd: "/data/agents/coder/repo",
};

const ASSISTANT_MESSAGE = {
  type: "assistant",
  message: { content: [{ type: "text", text: "All done." }] },
};

const SUCCESS_RESULT = {
  type: "result",
  subtype: "success",
  result: "All done.",
  num_turns: 3,
  duration_ms: 1200,
};

describe("runClaudeSDK session-id extraction (stubbed subprocess)", () => {
  it("extracts the native session id from the init message", async () => {
    const result = await runClaudeSDK("do the thing", {
      cwd: "/tmp/x",
      queryFn: makeQueryFn([INIT_MESSAGE, ASSISTANT_MESSAGE, SUCCESS_RESULT]),
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("All done.");
    expect(result.sessionId).toBe("sdk-sess-1234");
  });

  it("carries the session id on error results too", async () => {
    const result = await runClaudeSDK("do the thing", {
      cwd: "/tmp/x",
      queryFn: makeQueryFn([
        INIT_MESSAGE,
        { type: "result", subtype: "error_max_turns", num_turns: 25 },
      ]),
    });
    expect(result.success).toBe(false);
    expect(result.sessionId).toBe("sdk-sess-1234");
  });

  it("leaves sessionId undefined when no init message arrives", async () => {
    const result = await runClaudeSDK("do the thing", {
      cwd: "/tmp/x",
      queryFn: makeQueryFn([ASSISTANT_MESSAGE, SUCCESS_RESULT]),
    });
    expect(result.sessionId).toBeUndefined();
  });
});

describe("claudeAuthOptions", () => {
  it("passes ANTHROPIC_API_KEY through when no subscription token is set", () => {
    expect(claudeAuthOptions({ ANTHROPIC_API_KEY: "sk-ant-api" })).toEqual({
      apiKey: "sk-ant-api",
    });
  });

  it("prefers CLAUDE_CODE_OAUTH_TOKEN: no apiKey, API key cleared from the subprocess env", () => {
    const auth = claudeAuthOptions({
      ANTHROPIC_API_KEY: "sk-ant-api",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-123",
    });
    expect(auth.apiKey).toBeUndefined();
    // The undefined-valued key unsets ANTHROPIC_API_KEY at spawn, so the
    // subprocess sees only the OAuth token (Claude Code would otherwise
    // prefer the API key and silently ignore the subscription).
    expect(auth.env).toEqual({ ANTHROPIC_API_KEY: undefined });
  });

  it("ignores a blank subscription token", () => {
    expect(
      claudeAuthOptions({
        ANTHROPIC_API_KEY: "sk-ant-api",
        CLAUDE_CODE_OAUTH_TOKEN: "   ",
      }),
    ).toEqual({ apiKey: "sk-ant-api" });
  });

  it("clears the API key from the env runClaudeSDK hands the SDK", async () => {
    let capturedEnv: Record<string, string | undefined> | undefined;
    const capturingQueryFn: any = ({ options }: { options: any }) => {
      capturedEnv = options.env;
      return (async function* () {
        yield SUCCESS_RESULT;
      })();
    };
    await runClaudeSDK("do the thing", {
      cwd: "/tmp/x",
      ...claudeAuthOptions({
        ANTHROPIC_API_KEY: "sk-ant-api",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-123",
      }),
      queryFn: capturingQueryFn,
    });
    expect(capturedEnv).toBeDefined();
    expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("claudeNativeSessionPath", () => {
  it("encodes the cwd with Claude Code's dash convention", () => {
    expect(claudeProjectDirName("/data/agents/coder/repo")).toBe(
      "-data-agents-coder-repo",
    );
    expect(claudeProjectDirName("/Users/me/my.project_x")).toBe(
      "-Users-me-my-project-x",
    );
  });

  it("uses CLAUDE_CONFIG_DIR when set (container data volume)", () => {
    const path = claudeNativeSessionPath("/data/agents/coder/repo", "sess-1", {
      CLAUDE_CONFIG_DIR: "/data/claude-config",
    });
    expect(path).toBe(
      "/data/claude-config/projects/-data-agents-coder-repo/sess-1.jsonl",
    );
  });

  it("falls back to ~/.claude when the override is unset", () => {
    const path = claudeNativeSessionPath("/tmp/p", "sess-2", {});
    expect(path).toContain(join(".claude", "projects"));
    expect(path.endsWith("sess-2.jsonl")).toBe(true);
  });
});

describe("createClaudeSdkRuntimeRunner", () => {
  const agent: AgentEntry = {
    id: "coder",
    name: "Coder",
    projectPath: "/data/agents/coder/repo",
  };
  const ctx: RuntimeContext = {
    agent,
    sessionId: "habitat-sess",
    sessionDir: "/tmp/habitat-sess",
    channelKey: "web:abc",
  };

  function fakeRun(result: Partial<ClaudeSDKResult>): typeof runClaudeSDK {
    return async (_prompt, opts) => {
      // Mimic the real runner's progress stream so event wiring is pinned.
      opts.onProgress?.({ type: "text", content: "working…" });
      opts.onProgress?.({ type: "tool_use", content: "Using Bash", toolName: "Bash" });
      return {
        content: "done",
        success: true,
        numTurns: 1,
        durationMs: 10,
        messages: [],
        errors: [],
        ...result,
      };
    };
  }

  it("returns a nativeSessionRef pointing at the JSONL trace", async () => {
    const runner = createClaudeSdkRuntimeRunner(
      fakeRun({ sessionId: "sdk-sess-9" }),
    );
    const result = await runner.run("task", ctx, { onDone: async () => {} });
    expect(result.success).toBe(true);
    expect(result.nativeSessionRef).toMatchObject({
      runtime: "claude-sdk",
      nativeSessionId: "sdk-sess-9",
    });
    expect(result.nativeSessionRef?.nativeSessionPath).toContain(
      "-data-agents-coder-repo/sdk-sess-9.jsonl",
    );
  });

  it("omits the ref when the SDK reported no session id", async () => {
    const runner = createClaudeSdkRuntimeRunner(fakeRun({}));
    const result = await runner.run("task", ctx, { onDone: async () => {} });
    expect(result.nativeSessionRef).toBeUndefined();
  });

  it("streams progress into the bridge event handlers", async () => {
    const texts: string[] = [];
    const tools: string[] = [];
    const runner = createClaudeSdkRuntimeRunner(fakeRun({}));
    await runner.run("task", ctx, {
      onDone: async () => {},
      onText: (d) => texts.push(d),
      onToolCall: (name) => tools.push(name),
    });
    expect(texts).toEqual(["working…"]);
    expect(tools).toEqual(["Bash"]);
  });
});
