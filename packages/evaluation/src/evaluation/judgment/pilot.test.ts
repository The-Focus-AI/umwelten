import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  JudgmentBackend,
  JudgmentResult,
} from "@umwelten/core/judgment/types.js";
import { JudgmentError } from "@umwelten/core/judgment/types.js";
import {
  pilotKey,
  runPilot,
  summarizePilot,
  validateCase,
  type JudgmentCase,
} from "./pilot.js";

const fixture: JudgmentCase = {
  id: "one",
  family: "support",
  group: "contrast",
  request: {
    state: "Refund?",
    questions: {
      route: {
        kind: "choice",
        instructions: "Route?",
        options: { billing: "Invoices", other: "Other" },
      },
    },
  },
  expected: { route: "billing" },
};
const result: JudgmentResult = {
  answers: {
    route: {
      kind: "choice",
      selected: "billing",
      probabilities: { billing: 0.8, other: 0.2 },
    },
  },
  raw: {},
  metadata: {
    provider: "fixture",
    model: "fixture",
    requestedModel: "fixture",
    probabilitySource: "generated",
    execution: "joint-generation",
    startedAt: "2026-09-19T00:00:00Z",
    durationMs: 25,
  },
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("resumable judgment pilot", () => {
  it("invalidates cache on option order, question text, expected label and backend changes", () => {
    const key = pilotKey("first", fixture);
    const reversed: JudgmentCase = {
      ...fixture,
      request: {
        ...fixture.request,
        questions: {
          route: {
            kind: "choice",
            instructions: "Route?",
            options: { other: "Other", billing: "Invoices" },
          },
        },
      },
    };
    expect(pilotKey("first", reversed)).not.toBe(key);
    expect(pilotKey("second", fixture)).not.toBe(key);
    expect(
      pilotKey("first", { ...fixture, expected: { route: "other" } }),
    ).not.toBe(key);
    reversed.request.questions.route.instructions = "Different rubric";
    expect(pilotKey("first", reversed)).not.toBe(pilotKey("first", fixture));
  });
  it("persists successes and failures, and replay never calls the backend", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "judgment-"));
    directories.push(directory);
    const judge = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error("secret must not persist"));
    const backend = { identity: "fixture", judge } as JudgmentBackend;
    const cases = [fixture, { ...fixture, id: "two" }];
    const first = await runPilot(backend, cases, directory);
    expect(first.cacheHits).toBe(0);
    expect(judge.mock.calls[0][0]).toEqual(fixture.request);
    expect(judge.mock.calls[0][0]).not.toHaveProperty("expected");
    const replay = await runPilot(backend, cases, directory, { replay: true });
    expect(replay.cacheHits).toBe(2);
    expect(judge).toHaveBeenCalledTimes(2);
    expect(replay.records).toEqual(first.records);
    expect(JSON.stringify(replay.records)).not.toContain("secret");
    const summary = summarizePilot(replay.records);
    expect(summary.failed).toBe(1);
    expect(summary.unknownCostCalls).toBe(2);
    expect(summary.groups[0].meanBrier).toBeCloseTo(0.08);
    expect(summary.groups[0].accuracyAmongValid).toBe(1);
    expect(summary.groups[0].failed).toBe(1);
    await expect(
      runPilot(backend, [{ ...fixture, id: "missing" }], directory, {
        replay: true,
      }),
    ).rejects.toThrow("no calls made");
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("persists safe provider failure details and forwards abort deadlines", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "judgment-"));
    directories.push(directory);
    const judge = vi
      .fn()
      .mockRejectedValueOnce(new JudgmentError("http", { status: 429 }));
    const { records } = await runPilot(
      { identity: "failure", judge },
      [fixture],
      directory,
    );
    expect(records[0].errorDetails).toEqual({ status: 429 });
    expect(records[0].error).toBe("http");
    expect(judge.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await expect(
      runPilot({ identity: "failure", judge }, [fixture], directory, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("validates labels before spending", () => {
    expect(() =>
      validateCase({ ...fixture, expected: { route: "surprise" } }),
    ).toThrow();
    expect(() => validateCase({ ...fixture, expected: {} })).toThrow();
  });

  it("scores binary and ordinal answers separately and charges a batch only once", () => {
    const testCase: JudgmentCase = {
      id: "batch",
      family: "mixed",
      group: "batch",
      request: {
        state: "evidence",
        questions: {
          yes: { kind: "binary", instructions: "True?" },
          level: {
            kind: "ordinal",
            instructions: "Level?",
            levels: ["Low", "Medium", "High"],
          },
        },
      },
      expected: { yes: true, level: 0 },
    };
    const summary = summarizePilot([
      {
        version: 1,
        key: pilotKey("fixture", testCase),
        backend: "fixture",
        case: testCase,
        result: {
          ...result,
          metadata: {
            ...result.metadata,
            cost: { usd: 0.001, source: "provider-reported" },
          },
          answers: {
            yes: { kind: "binary", probabilityTrue: 0.2 },
            level: {
              kind: "ordinal",
              probabilities: [0.4, 0.35, 0.25],
              expectedIndex: 0.85,
            },
          },
        },
      },
    ]);
    expect(summary.calls).toBe(1);
    expect(summary.knownCostUsd).toBe(0.001);
    expect(summary.unknownCostCalls).toBe(0);
    expect(summary.groups[0].accuracyAmongValid).toBe(0);
    expect(summary.groups[0].meanBrier).toBeCloseTo(1.28);
    expect(summary.groups[1].accuracyAmongValid).toBe(1);
    expect(summary.groups[1].meanBrier).toBeCloseTo(0.545);
    expect(summary.groups[1].meanRankedProbabilityScore).toBeCloseTo(0.21125);
  });
});
