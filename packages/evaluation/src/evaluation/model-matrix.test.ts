import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addMatrixModel,
  loadLabDirModels,
  loadModelMatrix,
  removeMatrixModel,
  selectMatrixModels,
  setMatrixModelEnabled,
} from "../../../../examples/_shared/model-matrix.js";

describe("examples/_shared/model-matrix", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("loads default matrix, hydrates live catalog costs, and supports group/add/exclude/effort sweeps", () => {
    const manifest = loadModelMatrix();
    expect(manifest.defaultGroups).toEqual([
      "frontier-fable",
      "frontier-workhorse",
      "open-weight-cloud",
      "local-ollama",
    ]);

    const base = selectMatrixModels(manifest, {
      groups: ["frontier-fable", "frontier-workhorse", "open-weight-cloud"],
      add: ["ollama:gemma4:26b@off"],
      exclude: ["google:*"],
    });
    expect(base.some((m) => m.provider === "google")).toBe(false);
    expect(
      base.some(
        (m) =>
          m.provider === "ollama" &&
          m.name === "gemma4:26b" &&
          m.reasoningEffort === "off",
      ),
    ).toBe(true);

    const deepseek = base.find((m) => m.name === "deepseek/deepseek-v4.1-flash-1017");
    expect(deepseek?.costs?.promptTokens).toBeGreaterThan(0);

    const inklingMini = base.find((m) => m.name === "thinkingmachines/inkling-2-mini");
    expect(inklingMini?.costs?.promptTokens).toBeCloseTo(0.07);

    const swept = selectMatrixModels(manifest, {
      models: ["google:gemini-4-hydrogen", "anthropic:claude-haiku-5-5"],
      efforts: ["off", "high"],
    });
    expect(swept).toHaveLength(4);
    expect(swept.map((m) => `${m.name}@${m.reasoningEffort}`)).toEqual([
      "gemini-4-hydrogen@off",
      "gemini-4-hydrogen@high",
      "claude-haiku-5-5@off",
      "claude-haiku-5-5@high",
    ]);

    const groupSwept = selectMatrixModels(manifest, {
      groups: ["frontier-fable", "local-ollama"],
      add: ["openrouter:meta/muse-ember@medium"],
      exclude: ["gemini-4-neon"],
      useGroupEfforts: true,
    });
    expect(groupSwept.some((m) => m.name === "gemini-4-neon")).toBe(false);
    const fableSwept = groupSwept.filter((m) => m.name === "claude-fable-5-2");
    expect(fableSwept.map((m) => m.reasoningEffort)).toEqual(["low", "high"]);

    const ollamaSwept = groupSwept.filter((m) => m.name === "inkling-2-mini:latest");
    expect(ollamaSwept.map((m) => m.reasoningEffort)).toEqual(["off", "low", "high"]);

    const pinnedAdd = groupSwept.filter((m) => m.name === "meta/muse-ember");
    expect(pinnedAdd.map((m) => m.reasoningEffort)).toEqual(["medium"]);
  });

  it("adds, disables, enables, and removes models cleanly", () => {
    const manifest = loadModelMatrix();
    const added = addMatrixModel(manifest, "ollama:qwen3:30b@off", {
      tagline: "test local qwen",
    });
    expect(added.group).toBe("local-ollama");
    expect(added.replaced).toBe(false);

    const disabled = setMatrixModelEnabled(added.manifest, "ollama:qwen3:30b", false);
    expect(disabled.updatedCount).toBe(1);
    const activeAfterDisable = selectMatrixModels(disabled.manifest, {
      groups: ["local-ollama"],
    });
    expect(activeAfterDisable.some((m) => m.name === "qwen3:30b")).toBe(false);

    const enabled = setMatrixModelEnabled(disabled.manifest, "ollama:qwen3:30b", true);
    expect(enabled.updatedCount).toBe(1);

    const removed = removeMatrixModel(enabled.manifest, "ollama:qwen3:30b");
    expect(removed.removedCount).toBe(1);
  });

  it("reads best-config.json and configs/base.json from a local-model-labs directory", () => {
    const labDir = fs.mkdtempSync(path.join(os.tmpdir(), "umwelten-lab-dir-"));
    dirs.push(labDir);

    const m1 = path.join(labDir, "models", "inkling-2-mini-mlx-nvfp4");
    fs.mkdirSync(path.join(m1, "configs"), { recursive: true });
    fs.writeFileSync(
      path.join(m1, "best-config.json"),
      JSON.stringify({
        name: "base",
        base_url: "http://127.0.0.1:8000",
        model: "inkling-2-mini-mlx-nvfp4",
        extra_body: { enable_thinking: false },
      }),
    );

    const m2 = path.join(labDir, "models", "inkling-2-mini-ollama", "configs");
    fs.mkdirSync(m2, { recursive: true });
    fs.writeFileSync(
      path.join(m2, "base.json"),
      JSON.stringify({
        name: "base",
        base_url: "http://127.0.0.1:11435",
        model: "inkling-2-mini:latest",
        extra_body: { enable_thinking: false },
      }),
    );

    const loaded = loadLabDirModels(labDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({
      provider: "mlx",
      name: "inkling-2-mini-mlx-nvfp4",
      baseUrl: "http://127.0.0.1:8000",
      extraBody: { enable_thinking: false },
      tier: "local",
    });
    expect(loaded[1]).toMatchObject({
      provider: "ollama",
      name: "inkling-2-mini:latest",
      baseUrl: "http://127.0.0.1:11435",
      extraBody: { enable_thinking: false },
      tier: "local",
    });
  });
});
