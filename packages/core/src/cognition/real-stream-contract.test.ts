/**
 * REAL streamText contract guard.
 *
 * Every other runner/bridge test mocks above the AI SDK, so nothing exercises
 * the *actual* `streamText()` call — which is where the AI SDK validates the
 * request shape. That gap let ai@5→7 ship a fleet-wide outage: v7 rejects
 * system-role entries inside `messages` ("System messages are not allowed in
 * the prompt or messages fields"), and no CI test caught it because the real
 * call never ran.
 *
 * This test drives the real `streamText` from `ai` with a MockLanguageModel
 * (no API key, deterministic) over the exact options `buildRequestOptions`
 * produces from a system-prompted Interaction. If an `ai` bump changes the
 * request contract, this fails at merge time — not in prod.
 */
import { describe, it, expect } from "vitest";
import { streamText, generateText } from "ai";
import {
  MockLanguageModelV3,
  convertArrayToReadableStream,
} from "ai/test";
import { buildRequestOptions } from "./request-options.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { Interaction } from "../interaction/core/interaction.js";
import type { ModelDetails } from "./types.js";

function systemPromptedInteraction(): Interaction {
  const details: ModelDetails = { name: "mock", provider: "openrouter" };
  // Stimulus role becomes the system prompt (messages[0], role:system) —
  // the exact shape that broke on ai@7.
  const i = new Interaction(details, new Stimulus({ role: "a terse assistant" }));
  (i as any).messages.push({ role: "user", content: "say ok" });
  return i;
}

function mockTextModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
        { type: "text-end", id: "1" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        },
      ]),
    }),
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
      warnings: [],
    }),
  });
}

describe("real streamText contract (no API key)", () => {
  it("streams a system-prompted interaction without an SDK validation throw", async () => {
    const interaction = systemPromptedInteraction();
    const options = buildRequestOptions({
      interaction,
      model: mockTextModel("ok"),
      config: {},
      label: "test",
      streaming: true,
    });
    // The regression: on ai@7 this threw here if `messages` carried a
    // system entry. It must produce the mock's text instead.
    const result = streamText(options as Parameters<typeof streamText>[0]);
    let out = "";
    for await (const delta of result.textStream) out += delta;
    expect(out).toBe("ok");
  });

  it("generateText path accepts the same options shape", async () => {
    const interaction = systemPromptedInteraction();
    const options = buildRequestOptions({
      interaction,
      model: mockTextModel("done"),
      config: {},
      label: "test",
      streaming: false,
    });
    const result = await generateText(options as Parameters<typeof generateText>[0]);
    expect(result.text).toBe("done");
  });

  it("the model actually received the system prompt (hoisted, not dropped)", async () => {
    const interaction = systemPromptedInteraction();
    let seenSystem: string | undefined;
    const model = new MockLanguageModelV3({
      doStream: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === "system");
        seenSystem = sys && typeof sys.content === "string" ? sys.content : undefined;
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
          ]),
        };
      },
    });
    const options = buildRequestOptions({
      interaction,
      model,
      config: {},
      label: "test",
      streaming: true,
    });
    const result = streamText(options as Parameters<typeof streamText>[0]);
    for await (const _ of result.textStream) { /* drain */ }
    expect(seenSystem).toMatch(/terse assistant/);
  });
});
