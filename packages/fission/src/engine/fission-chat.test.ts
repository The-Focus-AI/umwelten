/**
 * End-to-end coverage of the turn loop with the model faked out.
 *
 * Interaction is mocked module-wide, so the answering call, the analysis pass,
 * the judge, and the compaction strategies all resolve against scripted
 * responses. What's under test is the orchestration: detect before answering,
 * fork into a seeded child, compact after, and record all of it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const analysisCalls: string[] = [];

vi.mock("@umwelten/core/interaction/core/interaction.js", () => {
  function response(content: string) {
    return {
      content,
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        tokenUsage: { promptTokens: 100, completionTokens: 20, total: 120 },
        provider: "fake",
        model: "fake-model",
        cost: { promptCost: 0.0001, completionCost: 0.0001, totalCost: 0.0002, usage: { promptTokens: 100, completionTokens: 20 } },
      },
    };
  }

  class FakeInteraction {
    id: string;
    messages: { role: string; content: unknown }[] = [];
    tools: unknown;
    maxSteps: number | undefined;
    metadata = { created: new Date(), updated: new Date() };

    constructor(
      public modelDetails: { name: string; provider: string },
      public stimulus: { options?: { role?: string } },
      options?: { id?: string },
    ) {
      this.id = options?.id ?? "fake";
      this.messages.push({ role: "system", content: "system prompt" });
    }

    addMessage(message: { role: string; content: unknown }) {
      this.messages.push(message);
    }

    getMessages() {
      return this.messages;
    }

    async streamText(_signal?: AbortSignal, observer?: { onTextDelta?: (d: string) => void }) {
      const last = this.messages[this.messages.length - 1];
      const text = `answered: ${String(last?.content ?? "").slice(0, 60)}`;
      observer?.onTextDelta?.(text);
      // The real runner appends the final assistant message to the interaction
      // via assembleSteps before returning (see cognition/step-assembler.ts).
      // The fake has to do the same or the context never grows and compaction
      // has nothing to work on.
      this.messages.push({ role: "assistant", content: text });
      return response(text);
    }

    async generateObject() {
      const role = this.stimulus?.options?.role;
      if (role === "conversation analyst") {
        const last = String(this.messages[this.messages.length - 1]?.content ?? "");
        analysisCalls.push(last);
        return response(
          JSON.stringify({
            summary: "Discussed the question.",
            facts: ["a durable fact"],
            topics: ["testing", "fission"],
            openQuestion: "",
          }),
        );
      }
      return response(
        JSON.stringify({
          relationship: "new-topic",
          confidence: 0.9,
          reason: "Judged as unrelated.",
          proposedTitle: "Judged Thread",
        }),
      );
    }

    getRunner() {
      return {
        generateText: async () => response("## Through-line\nA compacted record.\n\n## Established\n- a durable fact"),
      };
    }
  }

  return { Interaction: FakeInteraction };
});

const { FissionChat } = await import("./fission-chat.js");
const { FissionStore } = await import("../tree/store.js");

const MODEL = { name: "fake-model", provider: "fake" };

const KV_QUESTION = "How does prefix caching choose which slot to reuse for a prompt?";
const KV_FOLLOWUP = "And how does that prefix matching behave when every slot is busy?";
const OFF_TOPIC =
  "Different topic — what temperature should I proof sourdough at overnight in a cold kitchen?";

let dir: string;
let store: InstanceType<typeof FissionStore>;

beforeEach(async () => {
  analysisCalls.length = 0;
  dir = await mkdtemp(join(tmpdir(), "fission-e2e-"));
  store = new FissionStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function newChat(config: Record<string, unknown> = {}) {
  return FissionChat.create({
    store,
    model: MODEL,
    title: "E2E",
    config: {
      detectorId: "lexical-drift",
      shadowDetectorIds: ["never"],
      compactionStrategyId: "rolling-summary",
      carryoverStrategyId: "topic-carryover",
      compactEveryTurn: true,
      compactAboveTokens: 4000,
      keepRecentMessages: 2,
      driftThreshold: 0.6,
      autoFork: true,
      minTurnsBeforeFork: 1,
      ...config,
    } as never,
  });
}

describe("FissionChat turn loop", () => {
  it("records a first turn in the root without forking", async () => {
    const chat = await newChat();
    const turn = await chat.send(KV_QUESTION);

    expect(turn.nodeId).toBe(chat.tree.data.rootId);
    expect(turn.arrivedAtNodeId).toBe(turn.nodeId);
    expect(turn.assistantText).toContain("answered:");
    expect(turn.detector?.verdict).toBe("continue");
    expect(turn.analysis?.summary).toBe("Discussed the question.");
    expect(chat.tree.stats().turnCount).toBe(1);
  });

  it("keeps an on-topic follow-up in the same thread", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const turn = await chat.send(KV_FOLLOWUP);

    expect(turn.nodeId).toBe(chat.tree.data.rootId);
    expect(chat.tree.stats().nodeCount).toBe(1);
    expect(chat.tree.stats().forkCount).toBe(0);
  });

  it("spins an unrelated turn into a seeded child", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    await chat.send(KV_FOLLOWUP);
    const turn = await chat.send(OFF_TOPIC);

    expect(turn.nodeId).not.toBe(turn.arrivedAtNodeId);
    const child = chat.tree.requireNode(turn.nodeId);
    expect(child.parentId).toBe(chat.tree.data.rootId);
    expect(child.bornFromTurnId).toBe(turn.id);
    expect(child.seed?.strategyId).toBe("topic-carryover");
    expect(child.seed?.text).toContain("Carried over");
    // The parent keeps its turns — fission splits, it doesn't move.
    expect(chat.tree.requireNode(chat.tree.data.rootId).turnIds).toHaveLength(2);
    expect(chat.tree.data.activeNodeId).toBe(child.id);
  });

  it("detects and forks before answering", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const events: string[] = [];
    await chat.send(OFF_TOPIC, { onEvent: (event) => events.push(event.type) });

    expect(events[0]).toBe("turn-start");
    expect(events.indexOf("detect")).toBeLessThan(events.indexOf("answer-start"));
    // Forking after answering would put the new thread's first exchange in the
    // old thread's context — the exact thing fission exists to prevent.
    expect(events.indexOf("fork")).toBeGreaterThan(-1);
    expect(events.indexOf("fork")).toBeLessThan(events.indexOf("answer-start"));
    expect(events[events.length - 1]).toBe("turn-complete");
  });

  it("analyses then compacts, after answering", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const events: string[] = [];
    await chat.send(KV_FOLLOWUP, { onEvent: (event) => events.push(event.type) });

    expect(events).not.toContain("fork");
    expect(events.indexOf("answer")).toBeLessThan(events.indexOf("analysis"));
    expect(events.indexOf("analysis")).toBeLessThan(events.indexOf("compaction"));
    expect(events[events.length - 1]).toBe("turn-complete");
  });

  it("does not compact a freshly forked thread that has nothing to compact", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const turn = await chat.send(OFF_TOPIC);

    // One exchange in a brand-new child, with a 2-message tail kept verbatim,
    // leaves no segment worth summarizing.
    expect(turn.nodeId).not.toBe(turn.arrivedAtNodeId);
    expect(turn.compaction).toBeUndefined();
  });

  it("records a fork proposal without acting when autoFork is off", async () => {
    const chat = await newChat({ autoFork: false });
    await chat.send(KV_QUESTION);
    await chat.send(KV_FOLLOWUP);
    const turn = await chat.send(OFF_TOPIC);

    expect(turn.detector?.verdict).toBe("fork");
    expect(turn.nodeId).toBe(turn.arrivedAtNodeId);
    expect(chat.tree.stats().nodeCount).toBe(1);
  });

  it("honours minTurnsBeforeFork", async () => {
    const chat = await newChat({ minTurnsBeforeFork: 5 });
    await chat.send(KV_QUESTION);
    const turn = await chat.send(OFF_TOPIC);

    expect(turn.detector?.verdict).toBe("fork");
    expect(chat.tree.stats().nodeCount).toBe(1);
  });

  it("forks on demand regardless of the score", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const turn = await chat.send(KV_FOLLOWUP, { forceFork: true });

    expect(turn.nodeId).not.toBe(chat.tree.data.rootId);
    expect(chat.tree.stats().nodeCount).toBe(2);
  });

  it("scores shadow detectors without acting on them", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const turn = await chat.send(OFF_TOPIC);

    expect(turn.shadowDetectors.map((s) => s.detectorId)).toEqual(["never"]);
    expect(turn.shadowDetectors[0].verdict).toBe("continue");
    // The active detector forked anyway — the shadow is instrumentation only.
    expect(turn.detector?.verdict).toBe("fork");
  });

  it("compacts after the turn and shrinks the context", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const turn = await chat.send(KV_FOLLOWUP);

    expect(turn.compaction?.strategyId).toBe("rolling-summary");
    expect(turn.compaction?.error).toBeUndefined();
    expect(turn.compaction!.tokensAfter).toBeLessThan(turn.compaction!.tokensBefore);
    expect(turn.contextTokensAfter).toBeLessThan(
      turn.contextTokensBefore + turn.userText.length,
    );
  });

  it("skips compaction when configured to wait for a size threshold", async () => {
    const chat = await newChat({ compactEveryTurn: false, compactAboveTokens: 1_000_000 });
    await chat.send(KV_QUESTION);
    const turn = await chat.send(KV_FOLLOWUP);
    expect(turn.compaction).toBeUndefined();
  });

  it("persists the tree, the turn log, and node messages", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    await chat.send(OFF_TOPIC);

    const reloaded = await FissionChat.open({ treeId: chat.tree.id, store, model: MODEL });
    expect(reloaded.tree.stats().turnCount).toBe(2);
    expect(reloaded.tree.stats().nodeCount).toBe(2);
    expect(reloaded.tree.data.activeNodeId).toBe(chat.tree.data.activeNodeId);

    const messages = await store.loadNodeMessages(chat.tree.id, chat.tree.data.activeNodeId);
    expect(messages && messages.length).toBeGreaterThan(0);
  });
});

describe("FissionChat playground", () => {
  it("runs an alternate strategy against a rebuilt raw context", async () => {
    // autoFork off so the whole conversation stays in one node and the rebuilt
    // context is long enough for a window strategy to actually drop something.
    const chat = await newChat({ autoFork: false });
    let last = await chat.send(KV_QUESTION);
    for (const question of [
      "And how does that prefix matching behave when every slot is busy?",
      "Does the prefix reuse survive a slot eviction, or is the cache cold again?",
      "How large does the shared prefix have to be before reuse pays for itself?",
    ]) {
      last = await chat.send(question);
    }

    const record = await chat.tryCompaction({
      turnId: last.id,
      strategyId: "recent-window",
      keepRecentMessages: 2,
    });

    expect(record?.strategyId).toBe("recent-window");
    expect(record?.error).toBeUndefined();
    expect(record!.tokensAfter).toBeLessThan(record!.tokensBefore);
    expect(chat.tree.turns.get(last.id)?.altCompactions?.["recent-window"]).toBeDefined();
  });

  it("gives every strategy the same input at the same turn", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    const second = await chat.send(KV_FOLLOWUP);

    const a = await chat.tryCompaction({ turnId: second.id, strategyId: "recent-window" });
    const b = await chat.tryCompaction({ turnId: second.id, strategyId: "rolling-summary" });

    // Same rebuilt context in, so the ratios are directly comparable — which is
    // the whole point of the playground over comparing live runs.
    expect(a!.tokensBefore).toBe(b!.tokensBefore);
    expect(a!.segmentStart).toBe(b!.segmentStart);
    expect(a!.segmentEnd).toBe(b!.segmentEnd);
  });

  it("returns undefined for a turn that doesn't exist", async () => {
    const chat = await newChat();
    expect(
      await chat.tryCompaction({ turnId: "nope", strategyId: "recent-window" }),
    ).toBeUndefined();
  });

  it("rebuilds raw context from the turn log, not the compacted live context", async () => {
    const chat = await newChat();
    await chat.send(KV_QUESTION);
    await chat.send(KV_FOLLOWUP);

    const raw = chat.rebuildRawMessages(chat.tree.data.rootId);
    // system + two full exchanges, uncompacted.
    expect(raw).toHaveLength(5);
    expect(raw[1].content).toBe(KV_QUESTION);
    const live = chat.interactionFor(chat.tree.data.rootId).messages;
    expect(live.length).toBeLessThan(raw.length);
  });
});
