import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAgentManifest,
  parseAgentManifest,
  resolveManifestPath,
  AgentManifestError,
} from "./agent-manifest.js";

describe("parseAgentManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const m = parseAgentManifest({ name: "twitter-mcp" });
    expect(m.name).toBe("twitter-mcp");
    expect(m.publicMcp).toBe(false);
    expect(m.publicRoutes).toEqual([]);
  });

  it("requires publicAuth when publicMcp is true", () => {
    expect(() =>
      parseAgentManifest({ name: "x", publicMcp: true }),
    ).toThrow(AgentManifestError);
  });

  it("accepts a full mcp-agent manifest", () => {
    const m = parseAgentManifest({
      name: "twitter-mcp",
      description: "Twitter MCP server",
      publicUiDir: "public",
      publicMcp: true,
      publicAuth: {
        kind: "oauth-server",
        upstreamProvider: "src/upstream.ts",
        registerTools: "src/tools.ts",
        store: { driver: "sqlite", path: "/data/agents/twitter/oauth.db" },
      },
      publicRoutes: ["/oauth/*"],
    });
    expect(m.publicMcp).toBe(true);
    expect(m.publicAuth?.upstreamProvider).toBe("src/upstream.ts");
    expect(m.publicRoutes).toEqual(["/oauth/*"]);
  });

  it("preserves unknown keys (passthrough)", () => {
    const m = parseAgentManifest({ name: "x", customMeta: { author: "me" } });
    expect((m as any).customMeta).toEqual({ author: "me" });
  });
});

describe("loadAgentManifest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-manifest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file is missing", async () => {
    const result = await loadAgentManifest(dir);
    expect(result).toBeNull();
  });

  it("reads and parses a valid manifest", async () => {
    await writeFile(
      join(dir, "agent-manifest.json"),
      JSON.stringify({ name: "demo", publicUiDir: "public" }),
    );
    const result = await loadAgentManifest(dir);
    expect(result?.manifest.name).toBe("demo");
    expect(result?.path).toBe(join(dir, "agent-manifest.json"));
  });

  it("throws AgentManifestError on invalid JSON", async () => {
    await writeFile(join(dir, "agent-manifest.json"), "{not json");
    await expect(loadAgentManifest(dir)).rejects.toThrow(AgentManifestError);
  });

  it("throws AgentManifestError on validation failure", async () => {
    await writeFile(
      join(dir, "agent-manifest.json"),
      JSON.stringify({ publicMcp: true }), // missing name + publicAuth
    );
    await expect(loadAgentManifest(dir)).rejects.toThrow(AgentManifestError);
  });
});

describe("resolveManifestPath", () => {
  it("resolves relative paths against the repo dir", () => {
    expect(resolveManifestPath("/repo", "src/x.ts")).toBe("/repo/src/x.ts");
  });

  it("returns absolute paths unchanged", () => {
    expect(resolveManifestPath("/repo", "/abs/x.ts")).toBe("/abs/x.ts");
  });
});
