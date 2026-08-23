/**
 * The serving contract, as unit tests: every path in SERVING-CONTRACT.md
 * resolves, the substrate transpiles to browser ESM (no TypeScript syntax
 * survives), and nothing outside the contract is reachable.
 */

import { describe, it, expect } from "vitest";
import { resolveShellRequest } from "./serve-shell.js";

const asText = (body: string | Buffer) => body.toString();

describe("the serving contract", () => {
  it("redirects the bare prefix to a trailing slash so relative URLs resolve", async () => {
    const r = await resolveShellRequest("/shell");
    expect(r?.status).toBe(302);
    expect(r?.location).toBe("/shell/");
  });

  it("serves the shell page at the prefix root", async () => {
    const r = await resolveShellRequest("/shell/");
    expect(r?.status).toBe(200);
    expect(r?.contentType).toContain("text/html");
    expect(asText(r!.body)).toContain('src="./shell.js"');
  });

  it("serves the boot script", async () => {
    const r = await resolveShellRequest("/shell/shell.js");
    expect(r?.status).toBe(200);
    expect(asText(r!.body)).toContain("./substrate/index.js");
  });

  it("serves a manifest whose default lists the built-in components", async () => {
    const r = await resolveShellRequest("/shell/manifest.json");
    const manifest = JSON.parse(asText(r!.body));
    expect(manifest.entries.map((e: { id: string }) => e.id)).toEqual([
      "status",
      "conversation",
      "chat",
      "quick-prompts",
    ]);
  });

  it("a host can supply its own entries", async () => {
    const r = await resolveShellRequest("/shell/manifest.json", {
      entries: [{ id: "x", url: "./components/x.js", config: { n: 1 } }],
    });
    expect(JSON.parse(asText(r!.body)).entries[0]).toEqual({
      id: "x",
      url: "./components/x.js",
      config: { n: 1 },
    });
  });

  it("transpiles the substrate to browser ESM — no TypeScript syntax survives", async () => {
    for (const mod of ["index.js", "context.js", "services.js", "loader.js"]) {
      const r = await resolveShellRequest(`/shell/substrate/${mod}`);
      expect(r?.status, mod).toBe(200);
      expect(r?.contentType, mod).toContain("javascript");
      const code = asText(r!.body);
      expect(code, mod).not.toMatch(/\binterface\s+\w/);
      expect(code, mod).not.toMatch(/:\s*ServiceKey</);
      expect(code, mod).toMatch(/export\s*\{/);
    }
  });

  it("relative imports inside the substrate keep resolving under the prefix", async () => {
    const r = await resolveShellRequest("/shell/substrate/index.js");
    expect(asText(r!.body)).toContain('from "./context.js"');
  });

  it("serves component modules raw", async () => {
    const r = await resolveShellRequest("/shell/components/status.js");
    expect(r?.status).toBe(200);
    expect(asText(r!.body)).toContain("customElements");
  });

  it("ignores paths outside the prefix", async () => {
    expect(await resolveShellRequest("/api/status")).toBeUndefined();
    expect(await resolveShellRequest("/")).toBeUndefined();
    expect(await resolveShellRequest("/shellac")).toBeUndefined();
  });

  it("refuses traversal and non-module names", async () => {
    for (const path of [
      "/shell/substrate/../secrets.js",
      "/shell/substrate/..%2Fsecrets.js",
      "/shell/components/../../package.json",
      "/shell/substrate/context.ts",
    ]) {
      const r = await resolveShellRequest(path);
      expect(r?.status, path).toBe(404);
    }
  });

  it("unknown files inside the prefix are 404, not errors", async () => {
    const r = await resolveShellRequest("/shell/substrate/nope.js");
    expect(r?.status).toBe(404);
  });
});
