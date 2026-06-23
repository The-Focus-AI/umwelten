import { describe, it, expect } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { aiResultToMcpContent, registerAiTool } from "./mcp-tool-bridge.js";
import { buildHabitatUIResource, withUIResources } from "./ui-resources.js";

// ADR 0005 slice C (#196) — UI resources pass through as EmbeddedResource blocks.
describe("aiResultToMcpContent", () => {
  it("flattens a plain object result to a single text block (unchanged)", () => {
    const content = aiResultToMcpContent({ ok: true, n: 1 });
    expect(content).toEqual([
      { type: "text", text: JSON.stringify({ ok: true, n: 1 }, null, 2) },
    ]);
  });

  it("passes a string result through as text", () => {
    expect(aiResultToMcpContent("hi")).toEqual([{ type: "text", text: "hi" }]);
  });

  it("emits an EmbeddedResource block + a text block for a UI-resource result", () => {
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>x</p>" });
    const content = aiResultToMcpContent(
      withUIResources({ published: true }, [r]),
    );
    expect(content[0]).toEqual({ type: "resource", resource: r });
    expect(content[1].type).toBe("text");
    // the carrier key is stripped from the text the model/client sees
    expect(content[1].text as string).not.toContain("_uiResources");
    expect(JSON.parse(content[1].text as string)).toEqual({ published: true });
  });
});

describe("registerAiTool", () => {
  function captureHandler() {
    let handler: ((p: Record<string, unknown>) => Promise<any>) | undefined;
    const server = {
      registerTool: (_n: string, _c: unknown, h: typeof handler) => {
        handler = h;
      },
    } as any;
    return { server, get: () => handler! };
  }

  it("registers a handler that returns EmbeddedResource content for a UI tool", async () => {
    const { server, get } = captureHandler();
    const r = buildHabitatUIResource({ uri: "ui://h/w", html: "<p>x</p>" });
    const uiTool = tool({
      description: "emits ui",
      inputSchema: z.object({}),
      execute: async () => withUIResources({ published: true }, [r]),
    });
    registerAiTool(server, "ui_demo", uiTool);
    const out = await get()({});
    expect(out.content[0]).toEqual({ type: "resource", resource: r });
  });

  it("skips client-only tools without execute", () => {
    const calls: string[] = [];
    const server = { registerTool: (n: string) => calls.push(n) } as any;
    registerAiTool(server, "noexec", { description: "x" } as any);
    expect(calls).toEqual([]);
  });
});
