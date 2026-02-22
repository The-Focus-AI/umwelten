import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LLMContainerBuilder } from "./llm-container-builder.js";

describe("LLMContainerBuilder (exploratory)", () => {
  let cacheDir: string;
  let builder: LLMContainerBuilder;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "llm-container-builder-test-"));
    builder = new LLMContainerBuilder(cacheDir);
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("parses markdown-wrapped JSON config responses", () => {
    const response = [
      "```json",
      JSON.stringify(
        {
          baseImage: "python:3.11-alpine",
          setupCommands: ["pip install requests"],
          runCommand: ["python", "/app/code.py"],
          cacheVolumes: [{ name: "pip-cache", mountPath: "/root/.cache/pip" }],
          reasoning: "ignored by parser",
        },
        null,
        2,
      ),
      "```",
    ].join("\n");

    const config = (builder as any).parseConfigResponse(
      response,
      "python",
      ["requests"],
    );

    expect(config.baseImage).toBe("python:3.11-alpine");
    expect(config.setupCommands).toEqual(["pip install requests"]);
    expect(config.runCommand).toEqual(["python", "/app/code.py"]);
    expect(config.cacheVolumes).toEqual([
      { name: "pip-cache", mountPath: "/root/.cache/pip" },
    ]);
  });

  it("falls back to language defaults when response is not parseable JSON", () => {
    const config = (builder as any).parseConfigResponse(
      "I think this should run in a container, good luck!",
      "typescript",
      [],
    );

    expect(config.baseImage).toBe("node:20-alpine");
    expect(config.runCommand).toEqual(["npx", "tsx", "/app/code.ts"]);
  });

  it("exploratory: currently accepts malformed JSON shapes without schema validation", () => {
    const response = JSON.stringify({
      baseImage: "node:20",
      setupCommands: "npm install", // should be string[]
      runCommand: "node code.js", // should be string[]
      cacheVolumes: "npm-cache", // should be array
    });

    const config = (builder as any).parseConfigResponse(
      response,
      "javascript",
      [],
    );

    // Current behavior: parser trusts field types from the LLM payload.
    // This test documents the risk so we can harden with schema validation.
    expect(config.baseImage).toBe("node:20");
    expect(config.setupCommands).toBe("npm install");
    expect(config.runCommand).toBe("node code.js");
    expect(config.cacheVolumes).toBe("npm-cache");
  });
});

