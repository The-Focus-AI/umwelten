import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDimension, loadSuite } from "./loader.js";
import type { EvalDimension } from "./types.js";

describe("combine/loader transcript filtering and modern modelKey parsing", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("ignores *.transcript.json files and parses effort + modern providers", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "umwelten-loader-test-"));
    dirs.push(baseDir);

    const taskDir = path.join(baseDir, "unit-dim", "runs", "001", "task-1");
    fs.mkdirSync(taskDir, { recursive: true });

    const cases = [
      { file: "claude-haiku-5-5-anthropic-effort-high.json", score: 5 },
      { file: "gemini-3.8-flash-google-effort-off.json", score: 4 },
      { file: "inkling-2-mini-mlx-nothink.json", score: 5 },
      { file: "kimi-k3.1-pro-mycel.json", score: 5 },
    ];

    for (const c of cases) {
      fs.writeFileSync(
        path.join(taskDir, c.file),
        JSON.stringify({ score: c.score, cost: 0.001, durationMs: 100 }),
      );
      fs.writeFileSync(
        path.join(taskDir, c.file.replace(".json", ".transcript.json")),
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      );
    }

    const dim: EvalDimension = {
      evalName: "unit-dim",
      label: "Unit Dim",
      maxScore: 5,
      perTaskMaxScore: 5,
      extractScore: (r) => r.score ?? 0,
    };

    const { scores, taskResults } = loadDimension(dim, path.join(baseDir, "unit-dim", "runs", "001"));
    expect(taskResults).toHaveLength(4);
    expect(scores.size).toBe(4);

    const suite = loadSuite([dim], { baseDir });
    const byKey = new Map(suite.scorecards.map((s) => [s.modelKey, s]));
    expect(byKey.get("claude-haiku-5-5-anthropic-effort-high")).toMatchObject({
      model: "claude-haiku-5-5",
      provider: "anthropic",
    });
    expect(byKey.get("gemini-3.8-flash-google-effort-off")).toMatchObject({
      model: "gemini-3.8-flash",
      provider: "google",
    });
    expect(byKey.get("inkling-2-mini-mlx-nothink")).toMatchObject({
      model: "inkling-2-mini",
      provider: "mlx-nothink",
    });
    expect(byKey.get("kimi-k3.1-pro-mycel")).toMatchObject({
      model: "kimi-k3.1-pro",
      provider: "mycel",
    });
  });
});
