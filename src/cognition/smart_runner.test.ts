import { describe, it, expect, vi } from "vitest";
import { SmartModelRunner, RunnerHook, RunnerAbort, RunnerModification } from "./smart_runner.js";
import { BaseModelRunner } from "./runner.js";
import { Interaction } from "../interaction/core/interaction.js";
import { InMemoryMemoryStore } from "../memory/memory_store.js";
import { Stimulus } from "../stimulus/stimulus.js";

describe("SmartModelRunner", () => {
  const dummyModelResponse = {
    content: "dummy",
    metadata: {
      startTime: new Date(),
      endTime: new Date(),
      tokenUsage: { promptTokens: 1, completionTokens: 1, total: 2 },
      provider: "test",
      model: "test-model",
    },
  };

  // DummyBaseRunner that does not call super and does not use provider logic
  class DummyBaseRunner {
    async generateText(interaction: Interaction) {
      return dummyModelResponse;
    }
    async streamText(interaction: Interaction) {
      // AI SDK v5 streaming interface expects a different structure
      return {
        ...dummyModelResponse,
        textStream: (async function* () {
          yield "dummy";
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'dummy' };
        })()
      };
    }
    // For SmartModelRunner's super() call, provide a dummy config
    get config() {
      return {};
    }
  }

  const makeConversation = () =>
    new Interaction(
      { provider: "ollama", name: "gemma3:27b" },
      new Stimulus({ role: "test assistant" })
    );

  it("calls before, during, and after hooks in order", async () => {
    const calls: string[] = [];
    const beforeHook: RunnerHook = async (ctx) => { calls.push("before"); };
    const duringHook: RunnerHook = async (ctx) => { calls.push("during"); };
    const afterHook: RunnerHook = async (ctx) => { calls.push("after"); };

    const runner = new SmartModelRunner({
      baseRunner: new DummyBaseRunner(),
      memoryStore: new InMemoryMemoryStore(),
      beforeHooks: [beforeHook],
      duringHooks: [duringHook],
      afterHooks: [afterHook],
    });

    await runner.generateText(makeConversation());
    expect(calls).toEqual(["before", "during", "after"]);
  });

  it("aborts if before hook returns RunnerAbort", async () => {
    const beforeHook: RunnerHook = async (ctx) => new RunnerAbort("fail");
    const runner = new SmartModelRunner({
      baseRunner: new DummyBaseRunner(),
      memoryStore: new InMemoryMemoryStore(),
      beforeHooks: [beforeHook],
    });
    await expect(runner.generateText(makeConversation())).rejects.toThrow("Aborted by before hook");
  });

  it("modifies context if before hook returns RunnerModification", async () => {
    const beforeHook: RunnerHook = async (ctx) =>
      new RunnerModification((c) => {
        (c as any).foo = "bar";
        return c;
      });
    const duringHook: RunnerHook = async (ctx) => {
      expect((ctx as any).foo).toBe("bar");
    };
    const runner = new SmartModelRunner({
      baseRunner: new DummyBaseRunner(),
      memoryStore: new InMemoryMemoryStore(),
      beforeHooks: [beforeHook],
      duringHooks: [duringHook],
    });
    await runner.generateText(makeConversation());
  });

  it("calls hooks for streamText as well", async () => {
    const calls: string[] = [];
    const beforeHook: RunnerHook = async (ctx) => { calls.push("before"); };
    const duringHook: RunnerHook = async (ctx) => { calls.push("during"); };
    const afterHook: RunnerHook = async (ctx) => { calls.push("after"); };

    const runner = new SmartModelRunner({
      baseRunner: new DummyBaseRunner(),
      memoryStore: new InMemoryMemoryStore(),
      beforeHooks: [beforeHook],
      duringHooks: [duringHook],
      afterHooks: [afterHook],
    });

    await runner.streamText(makeConversation());
    expect(calls).toEqual(["before", "during", "after"]);
  });
});