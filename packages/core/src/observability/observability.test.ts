import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  JsonlCompletionSink,
  MemoryCompletionSink,
  NullCompletionSink,
  getDefaultCompletionSink,
  setDefaultCompletionSink,
  resolveCompletionsDir,
  resolveSinkFromEnv,
} from "./sinks.js";
import { buildCompletionRecord, completionTokensFrom, completionCostFrom } from "./record.js";
import type { BuildCompletionRecordInput } from "./record.js";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "umw-obs-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  setDefaultCompletionSink(undefined);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function baseInput(overrides: Partial<BuildCompletionRecordInput> = {}): BuildCompletionRecordInput {
  return {
    interaction: {
      id: "trace-1",
      userId: "default",
      modelDetails: { provider: "openrouter", name: "anthropic/claude-sonnet-4" },
    },
    operation: "generateText",
    startTime: new Date("2026-03-04T10:00:00.000Z"),
    endTime: new Date("2026-03-04T10:00:01.500Z"),
    usage: { promptTokens: 1000, completionTokens: 200, total: 1200, cacheReadTokens: 800 },
    cost: {
      promptCost: 0.0005,
      completionCost: 0.003,
      totalCost: 0.0035,
      cacheReadCost: 0.00024,
      usage: { promptTokens: 1000, completionTokens: 200, total: 1200, cacheReadTokens: 800 },
    },
    outcome: "completed",
    finishReason: "stop",
    toolCallCount: 2,
    steps: 3,
    ...overrides,
  };
}

describe("buildCompletionRecord", () => {
  it("maps usage, cost, timing and attribution into a flat record", () => {
    const rec = buildCompletionRecord(baseInput());
    expect(rec.id).toMatch(/[0-9a-f-]{36}/);
    expect(rec.traceId).toBe("trace-1");
    expect(rec.userId).toBeUndefined(); // "default" is not attribution
    expect(rec.sessionId).toBeUndefined();
    expect(rec.tags).toEqual([]);
    expect(rec.kind).toBe("llm");
    expect(rec.operation).toBe("generateText");
    expect(rec.provider).toBe("openrouter");
    expect(rec.model).toBe("anthropic/claude-sonnet-4");
    expect(rec.startedAt).toBe("2026-03-04T10:00:00.000Z");
    expect(rec.endedAt).toBe("2026-03-04T10:00:01.500Z");
    expect(rec.durationMs).toBe(1500);
    expect(rec.tokens).toEqual({ prompt: 1000, completion: 200, total: 1200, cacheRead: 800 });
    expect(rec.cost).toEqual({
      prompt: 0.0005,
      completion: 0.003,
      total: 0.0035,
      cacheRead: 0.00024,
      source: "pricing-table",
    });
    expect(rec.outcome).toBe("completed");
    expect(rec.finishReason).toBe("stop");
    expect(rec.toolCallCount).toBe(2);
    expect(rec.steps).toBe(3);
    expect(rec.error).toBeUndefined();
  });

  it("carries explicit attribution when present", () => {
    const rec = buildCompletionRecord(
      baseInput({
        interaction: {
          id: "t",
          userId: "will",
          sessionId: "sess-9",
          app: "habitat",
          tags: ["nightly", "triage"],
          modelDetails: { provider: "google", name: "gemini-2.5-flash", reasoningEffort: "low" },
        },
      }),
    );
    expect(rec.userId).toBe("will");
    expect(rec.sessionId).toBe("sess-9");
    expect(rec.app).toBe("habitat");
    expect(rec.tags).toEqual(["nightly", "triage"]);
    expect(rec.reasoningEffort).toBe("low");
  });

  it("zero-fills tokens and omits cost for error records", () => {
    const rec = buildCompletionRecord(
      baseInput({ usage: null, cost: null, outcome: "error", error: "429 rate limited", finishReason: undefined }),
    );
    expect(rec.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
    expect(rec.cost).toBeUndefined();
    expect(rec.outcome).toBe("error");
    expect(rec.error).toBe("429 rate limited");
    expect("finishReason" in rec).toBe(false);
  });

  it("never reports a negative duration", () => {
    const rec = buildCompletionRecord(
      baseInput({ startTime: new Date("2026-01-01T00:00:10Z"), endTime: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(rec.durationMs).toBe(0);
  });
});

describe("completionTokensFrom / completionCostFrom", () => {
  it("derives total when the provider omits it", () => {
    expect(completionTokensFrom({ promptTokens: 3, completionTokens: 4 })).toEqual({
      prompt: 3,
      completion: 4,
      total: 7,
    });
  });
  it("returns undefined cost for null", () => {
    expect(completionCostFrom(null)).toBeUndefined();
  });
});

describe("JsonlCompletionSink", () => {
  it("appends one JSON line per record into a per-UTC-day file", () => {
    const dir = join(tmp(), "nested", "completions");
    const sink = new JsonlCompletionSink(dir);
    const a = buildCompletionRecord(baseInput());
    const b = buildCompletionRecord(baseInput({ startTime: new Date("2026-03-04T23:59:59Z") }));
    const c = buildCompletionRecord(baseInput({ startTime: new Date("2026-03-05T00:00:00Z") }));
    sink.record(a);
    sink.record(b);
    sink.record(c);

    expect(readdirSync(dir).sort()).toEqual(["2026-03-04.jsonl", "2026-03-05.jsonl"]);
    const lines = readFileSync(join(dir, "2026-03-04.jsonl"), "utf-8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(a);
    expect(JSON.parse(lines[1])).toEqual(b);
  });

  it("swallows write failures instead of throwing into the model call", () => {
    // Put a regular file where the sink's parent directory should be, so
    // `mkdir -p` fails with ENOTDIR.
    const parent = tmp();
    writeFileSync(join(parent, "blocker"), "not a dir");
    const sink = new JsonlCompletionSink(join(parent, "blocker", "completions"));
    expect(() => sink.record(buildCompletionRecord(baseInput()))).not.toThrow();
  });
});

describe("resolveCompletionsDir", () => {
  it("prefers UMWELTEN_COMPLETIONS_DIR", () => {
    expect(resolveCompletionsDir({ UMWELTEN_COMPLETIONS_DIR: "/tmp/x" }, "/nowhere")).toBe("/tmp/x");
  });

  it("uses <cwd>/.umwelten/completions when cwd is a project", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, ".git"));
    expect(resolveCompletionsDir({}, cwd)).toBe(join(cwd, ".umwelten", "completions"));
  });

  it("falls back to ~/.umwelten/completions outside a project", () => {
    expect(resolveCompletionsDir({}, tmp())).toBe(join(homedir(), ".umwelten", "completions"));
  });
});

describe("getDefaultCompletionSink", () => {
  it("is a NullCompletionSink under vitest without an explicit dir", () => {
    expect(process.env.VITEST).toBeTruthy();
    expect(getDefaultCompletionSink()).toBeInstanceOf(NullCompletionSink);
  });

  it("UMWELTEN_TRACE=0 disables recording even with an explicit dir", () => {
    expect(resolveSinkFromEnv({ UMWELTEN_TRACE: "0", UMWELTEN_COMPLETIONS_DIR: "/tmp/x" })).toBeInstanceOf(
      NullCompletionSink,
    );
  });

  it("writes JSONL when tracing is on", () => {
    const sink = resolveSinkFromEnv({ UMWELTEN_COMPLETIONS_DIR: "/tmp/x" });
    expect(sink).toBeInstanceOf(JsonlCompletionSink);
    expect((sink as JsonlCompletionSink).dir).toBe("/tmp/x");
  });

  it("honours setDefaultCompletionSink", () => {
    const mem = new MemoryCompletionSink();
    setDefaultCompletionSink(mem);
    expect(getDefaultCompletionSink()).toBe(mem);
  });
});
