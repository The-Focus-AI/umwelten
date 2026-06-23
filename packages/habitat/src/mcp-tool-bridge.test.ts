import { describe, it, expect } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { aiResultToMcpContent, registerAiTool } from "./mcp-tool-bridge.js";
import { buildHabitatUIResource, withUIResources } from "./ui-resources.js";
import {
  runWithSpeaker,
  getSpeaker,
  type Speaker,
} from "./identity/agent-speaker-context.js";

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

  // ADR 0005 §9 (#197) — interactive callbacks run as the viewer. The /mcp
  // route wraps tool dispatch in runWithSpeaker; this proves the bridge handler
  // preserves that identity into the tool's execute (the same primitive /a2a
  // already uses), so a per-user tool resolves the speaking user, not another.
  it("a tool dispatched under runWithSpeaker sees the speaker", async () => {
    const { server, get } = captureHandler();
    let seen: Speaker | undefined;
    const whoami = tool({
      description: "captures the speaker",
      inputSchema: z.object({}),
      execute: async () => {
        seen = getSpeaker();
        return "ok";
      },
    });
    registerAiTool(server, "whoami", whoami);

    await runWithSpeaker({ userId: "user-b", displayName: "B" }, () =>
      get()({}),
    );
    expect(seen).toEqual({ userId: "user-b", displayName: "B" });
  });

  it("a tool dispatched with no speaker sees undefined (bearer/dev)", async () => {
    const { server, get } = captureHandler();
    let seen: Speaker | undefined = { userId: "stale" };
    const whoami = tool({
      description: "captures the speaker",
      inputSchema: z.object({}),
      execute: async () => {
        seen = getSpeaker();
        return "ok";
      },
    });
    registerAiTool(server, "whoami", whoami);

    await runWithSpeaker(undefined, () => get()({}));
    expect(seen).toBeUndefined();
  });
});
