import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildHabitatUIResource,
  uiResourceToA2APart,
  uiResourceToMcpContent,
  withUIResources,
  extractUIResources,
  stripUIResources,
  publishUIResource,
  drainUIResources,
  UI_OUTPUT_MODE,
} from "./ui-resources.js";

// ADR 0005 slice B (#195) — canonical UI-resource shape + normalizer.
describe("buildHabitatUIResource", () => {
  it("builds a rawHtml resource with a ui:// id and inline text", () => {
    const r = buildHabitatUIResource({
      uri: "ui://habitat/widget",
      html: "<h1>Hello</h1>",
    });
    expect(r.uri).toBe("ui://habitat/widget");
    expect(r.text).toBe("<h1>Hello</h1>");
    expect(r.mimeType).toMatch(/^text\/html/);
  });

  it("absolutizes a relative externalUrl against the public origin (#194)", () => {
    const r = buildHabitatUIResource({
      uri: "ui://habitat/dash",
      externalUrl: "/files/artifacts/dash.html",
      origin: "https://agent.example.com",
    });
    expect(r.text).toBe("https://agent.example.com/files/artifacts/dash.html");
  });

  it("leaves an already-absolute externalUrl unchanged", () => {
    const r = buildHabitatUIResource({
      uri: "ui://habitat/dash",
      externalUrl: "https://cdn.example.com/d.html",
      origin: "https://agent.example.com",
    });
    expect(r.text).toBe("https://cdn.example.com/d.html");
  });

  it("rejects a uri that does not start with ui://", () => {
    expect(() =>
      buildHabitatUIResource({ uri: "https://x/y", html: "<p>x</p>" }),
    ).toThrow(/ui:\/\//);
  });

  it("rejects neither html nor externalUrl", () => {
    expect(() => buildHabitatUIResource({ uri: "ui://h/w" })).toThrow(
      /exactly one/i,
    );
  });

  it("rejects both html and externalUrl", () => {
    expect(() =>
      buildHabitatUIResource({
        uri: "ui://h/w",
        html: "<p>x</p>",
        externalUrl: "https://x/y",
      }),
    ).toThrow(/exactly one/i);
  });
});

describe("uiResourceToA2APart (normalizer)", () => {
  it("maps a UI resource to a DataPart tagged text/html+mcp", () => {
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>hi</p>" });
    const part = uiResourceToA2APart(r);
    expect(part.kind).toBe("data");
    expect(part.data).toEqual(r);
    expect(part.metadata).toMatchObject({
      mcpUi: true,
      outputMode: UI_OUTPUT_MODE,
      mimeType: r.mimeType,
    });
  });
});

describe("MCP carrier (#196)", () => {
  it("uiResourceToMcpContent wraps as an EmbeddedResource block", () => {
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>x</p>" });
    expect(uiResourceToMcpContent(r)).toEqual({ type: "resource", resource: r });
  });

  it("withUIResources / extractUIResources round-trip", () => {
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>x</p>" });
    expect(extractUIResources(withUIResources({ ok: true }, [r]))).toEqual([r]);
  });

  it("extractUIResources returns [] for plain / non-object results", () => {
    expect(extractUIResources({ ok: true })).toEqual([]);
    expect(extractUIResources("text")).toEqual([]);
    expect(extractUIResources(null)).toEqual([]);
  });

  it("stripUIResources removes only the carrier key", () => {
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>x</p>" });
    expect(stripUIResources(withUIResources({ ok: true }, [r]))).toEqual({
      ok: true,
    });
    expect(stripUIResources("text")).toBe("text");
  });
});

describe("UI-resource per-turn buffer", () => {
  it("publishes then drains (oldest first) and clears the buffer", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "ui-buf-"));
    const a = buildHabitatUIResource({ uri: "ui://h/a", html: "<p>a</p>" });
    const b = buildHabitatUIResource({ uri: "ui://h/b", html: "<p>b</p>" });
    await publishUIResource(workDir, a);
    await publishUIResource(workDir, b);

    const drained = await drainUIResources(workDir);
    expect(drained.map((r) => r.uri).sort()).toEqual(["ui://h/a", "ui://h/b"]);

    // Drain removes them — a second drain is empty.
    expect(await drainUIResources(workDir)).toEqual([]);
    const left = await readdir(join(workDir, "ui-resources"));
    expect(left).toEqual([]);
  });

  it("returns empty when nothing was published", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "ui-buf-empty-"));
    expect(await drainUIResources(workDir)).toEqual([]);
  });
});
