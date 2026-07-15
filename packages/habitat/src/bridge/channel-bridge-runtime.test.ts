/**
 * Unit tests for the RuntimeRunner seam in ChannelBridge (#118):
 * dispatch through registered runners, nativeSessionRef persistence to
 * session metadata, missing-runner errors, and the pi mode in routing.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelBridge } from "./channel-bridge.js";
import { coerceChannelBinding } from "./routing.js";
import type { RuntimeResult, RuntimeRunner } from "./types.js";
import type { AgentHost } from "../types.js";

// ── Fixture: a workDir with routing.json + a fake host ───────────────

async function makeFixture(runtime: "claude-sdk" | "pi") {
  const workDir = await mkdtemp(join(tmpdir(), "bridge-runtime-"));
  const sessionDir = join(workDir, "sessions", "sess-1");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(workDir, "routing.json"),
    JSON.stringify({
      channels: { "web:abc": { agentId: "coder", runtime } },
    }),
  );

  const updateSessionMetadata = vi.fn(async () => {});
  const host = {
    workDir,
    getAgent: (id: string) =>
      id === "coder"
        ? { id: "coder", name: "Coder", projectPath: "/data/agents/coder/repo" }
        : undefined,
    getOrCreateSession: async () => ({ sessionId: "sess-1", sessionDir }),
    updateSessionMetadata,
  } as unknown as AgentHost;

  return { workDir, sessionDir, host, updateSessionMetadata };
}

function makeRunner(result: Partial<RuntimeResult>): RuntimeRunner & {
  calls: Array<{ prompt: string; ctx: unknown }>;
} {
  const calls: Array<{ prompt: string; ctx: unknown }> = [];
  return {
    calls,
    async run(prompt, ctx) {
      calls.push({ prompt, ctx });
      return { content: "ran", success: true, ...result };
    },
  };
}

const REF = {
  runtime: "claude-sdk",
  nativeSessionId: "sdk-sess-7",
  nativeSessionPath: "/data/claude-config/projects/-x/sdk-sess-7.jsonl",
};

describe("ChannelBridge runtime dispatch (#118)", () => {
  it("dispatches through the registered runner and persists nativeSessionRef", async () => {
    const { host, sessionDir, updateSessionMetadata } =
      await makeFixture("claude-sdk");
    const runner = makeRunner({ nativeSessionRef: REF });
    const bridge = new ChannelBridge(host, {
      runtimeRunners: { "claude-sdk": runner },
    });

    let done: unknown;
    await bridge.handleMessage(
      { channelKey: "web:abc", text: "fix the tests" },
      { onDone: (r) => void (done = r) },
    );

    // Runner got the prompt + a full RuntimeContext.
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).toBe("fix the tests");
    expect(runner.calls[0].ctx).toMatchObject({
      sessionId: "sess-1",
      sessionDir,
      channelKey: "web:abc",
      agent: { id: "coder" },
    });

    // The linkage landed in session metadata.
    expect(updateSessionMetadata).toHaveBeenCalledWith("sess-1", {
      nativeSessionRef: REF,
    });

    // Envelope summary transcript was written.
    const transcript = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    expect(transcript).toContain("fix the tests");
    expect(transcript).toContain("ran");

    expect(done).toMatchObject({ content: "ran", sessionId: "sess-1" });
  });

  it("skips the metadata update when the runner returns no ref", async () => {
    const { host, updateSessionMetadata } = await makeFixture("claude-sdk");
    const runner = makeRunner({});
    const bridge = new ChannelBridge(host, {
      runtimeRunners: { "claude-sdk": runner },
    });

    await bridge.handleMessage(
      { channelKey: "web:abc", text: "hi" },
      { onDone: () => {} },
    );
    expect(updateSessionMetadata).not.toHaveBeenCalled();
  });

  it("errors cleanly when no runner is registered for the runtime", async () => {
    const { host } = await makeFixture("pi");
    const bridge = new ChannelBridge(host, {});

    let error: string | undefined;
    await bridge.handleMessage(
      { channelKey: "web:abc", text: "hi" },
      { onDone: () => {}, onError: (e) => void (error = e) },
    );
    expect(error).toContain('No runner registered for runtime "pi"');
  });

  it("still supports the legacy runClaudeSdk injection (wrapped, no ref)", async () => {
    const { host, updateSessionMetadata } = await makeFixture("claude-sdk");
    const legacy = vi.fn(async () => ({
      content: "legacy ran",
      success: true,
      errors: [] as string[],
    }));
    const bridge = new ChannelBridge(host, { runClaudeSdk: legacy });

    let done: unknown;
    await bridge.handleMessage(
      { channelKey: "web:abc", text: "task" },
      { onDone: (r) => void (done = r) },
    );

    expect(legacy).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({ cwd: "/data/agents/coder/repo" }),
    );
    expect(done).toMatchObject({ content: "legacy ran" });
    expect(updateSessionMetadata).not.toHaveBeenCalled();
  });
});

describe("routing accommodates the pi mode (#118)", () => {
  it("coerces an explicit pi binding", () => {
    expect(coerceChannelBinding({ agentId: "coder", runtime: "pi" })).toEqual({
      agentId: "coder",
      runtime: "pi",
      infoMessageId: undefined,
    });
  });

  it("preserves config-declared runtime names instead of silently downgrading", () => {
    // Unknown-to-the-bridge names are legitimate (config.runtimes declares
    // codex/opencode/…); a typo now fails loudly at dispatch ("No runner
    // registered") rather than silently running the base loop.
    expect(
      coerceChannelBinding({ agentId: "coder", runtime: "codex" as never }),
    ).toEqual({ agentId: "coder", runtime: "codex", infoMessageId: undefined });
  });
});
