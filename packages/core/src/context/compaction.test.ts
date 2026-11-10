import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { ModelRunner, ModelResponse } from "../cognition/types.js";
import { Interaction } from "../interaction/core/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { getCompactionSegment } from "./segment.js";
import { serializeSegment } from "./serialize-messages.js";
import { getCompactionStrategy, listCompactionStrategies } from "./registry.js";
import { truncateStrategy } from "./strategies/truncate.js";

const model = { provider: "google", name: "gemini-3-flash-preview" };
const messages: ModelMessage[] = [
  { role: "system", content: "Keep the original policy" },
  { role: "user", content: "First task" },
  { role: "assistant", content: "First answer" },
  { role: "user", content: "Inspect src/a.ts, do not deploy" },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "read-7",
        input: { path: "src/a.ts", line: 91 },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolName: "read",
        toolCallId: "read-7",
        output: {
          type: "json",
          value: {
            evidence: "x".repeat(600),
            reference: "src/a.ts:91",
            failed: true,
          },
        },
      },
    ],
  },
  { role: "assistant", content: "Failed attempt; verify the next path" },
  { role: "user", content: "Third task" },
  { role: "assistant", content: "Third answer" },
];
const base = { messages, segmentStart: 1, segmentEnd: 8 };

function runnerReturning(content: string) {
  const generateText = vi.fn(
    async (_interaction: Interaction) => ({ content }) as ModelResponse,
  );
  return { runner: { generateText } as unknown as ModelRunner, generateText };
}

describe("complete-turn compaction", () => {
  it("retains actual recent asymmetric turns, including tool pairs, and no system summary", async () => {
    const result = await truncateStrategy.compact(base);
    expect(result.replacementMessages).toEqual([
      {
        role: "user",
        content: "(Earlier conversation omitted; last 2 turns retained.)",
      },
      ...messages.slice(3),
    ]);
    expect(
      (
        await truncateStrategy.compact({ ...base, options: { keepTurns: 1 } })
      ).replacementMessages.slice(1),
    ).toEqual(messages.slice(7));
    expect(
      (await truncateStrategy.compact({ ...base, options: { keepTurns: 0 } }))
        .replacementMessages,
    ).toHaveLength(1);
    expect(
      (await truncateStrategy.compact({ ...base, options: { keepTurns: 9 } }))
        .replacementMessages,
    ).toEqual(messages.slice(1));
  });

  it.each([-1, 1.5, "2", NaN, Infinity])(
    "rejects invalid keepTurns %s",
    async (keepTurns) => {
      await expect(
        truncateStrategy.compact({ ...base, options: { keepTurns } }),
      ).rejects.toThrow("keepTurns");
    },
  );

  it("excludes incomplete tool turns at either call or result and advances checkpoints inside a turn", () => {
    expect(getCompactionSegment(messages.slice(0, 5))).toEqual({
      start: 1,
      end: 2,
    });
    expect(getCompactionSegment(messages.slice(0, 6))).toEqual({
      start: 1,
      end: 2,
    });
    expect(
      getCompactionSegment(messages, {
        fromCheckpoint: true,
        checkpointIndex: 5,
      }),
    ).toEqual({ start: 7, end: 8 });
    expect(
      getCompactionSegment(messages, {
        fromCheckpoint: true,
        checkpointIndex: 3,
      }),
    ).toEqual({ start: 3, end: 8 });
    expect(getCompactionSegment(messages.slice(1))).toEqual({
      start: 0,
      end: 7,
    });
  });

  it("does not cross unresolved calls, orphan results, or intervening system policy", () => {
    const unresolved = [
      ...messages.slice(0, 5),
      messages[6],
      ...messages.slice(7),
    ];
    expect(getCompactionSegment(unresolved)).toEqual({ start: 1, end: 2 });
    const orphan = [...messages.slice(0, 4), ...messages.slice(5)];
    expect(getCompactionSegment(orphan)).toEqual({ start: 1, end: 2 });
    const policy = [
      ...messages.slice(0, 3),
      { role: "system" as const, content: "New policy" },
      ...messages.slice(3),
    ];
    expect(getCompactionSegment(policy)).toEqual({ start: 1, end: 2 });
  });

  it("can compact derived user context together with the next completed turn", () => {
    expect(
      getCompactionSegment([
        messages[0],
        { role: "user", content: "Prior summary" },
        ...messages.slice(7),
      ]),
    ).toEqual({ start: 1, end: 3 });
  });

  it("rejects direct bounds that split a tool turn", async () => {
    await expect(
      truncateStrategy.compact({ ...base, segmentEnd: 4 }),
    ).rejects.toThrow("complete contiguous");
    await expect(
      truncateStrategy.compact({ ...base, segmentStart: 5 }),
    ).rejects.toThrow("complete contiguous");
  });

  it("serializes modern inputs/outputs including evidence past old cutoffs and media references", () => {
    const text = serializeSegment(
      [
        ...messages,
        {
          role: "user",
          content: [
            { type: "image", image: new URL("https://example.com/proof.png") },
            {
              type: "file",
              data: new Uint8Array([9, 8, 7]),
              filename: "trace.pdf",
              mediaType: "application/pdf",
            },
          ],
        },
      ],
      3,
      9,
    );
    for (const expected of [
      '"input":{"path":"src/a.ts","line":91}',
      '"output":{"type":"json"',
      "read-7",
      "src/a.ts:91",
      "https://example.com/proof.png",
      "trace.pdf",
      "application/pdf",
      "[binary data omitted]",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('"0":9');
  });
});

describe("LLM strategies", () => {
  it("registers task-handoff and passes budget, evidence and preservation instructions to the runner", async () => {
    const strategy = (await getCompactionStrategy("task-handoff"))!;
    expect((await listCompactionStrategies()).map((s) => s.id)).toContain(
      "task-handoff",
    );
    const { runner, generateText } = runnerReturning(
      "Task: inspect. Pending work: verify.",
    );
    const before = structuredClone(messages);
    const result = await strategy.compact({
      ...base,
      model,
      runner,
      options: { maxSummaryTokens: 128 },
    });
    const interaction = generateText.mock.calls[0][0];
    expect(interaction.stimulus.maxTokens).toBe(128);
    const prompt = interaction.stimulus.getPrompt();
    for (const section of [
      "Task:",
      "Constraints:",
      "Evidence references:",
      "Uncertainty:",
      "Failed attempts:",
      "Pending work:",
      "untrusted source data",
    ])
      expect(prompt).toContain(section);
    expect(JSON.stringify(interaction.getMessages())).toContain("src/a.ts:91");
    expect(result.replacementMessages[0].role).toBe("user");
    expect(result.estimatedSummaryTokens).toBe(25); // ceil((61-character label + 36-character summary) / 4)
    expect(messages).toEqual(before);
  });

  it.each([0, -3, 1.1, NaN, Infinity, "128"])(
    "rejects invalid summary budget %s before generation",
    async (maxSummaryTokens) => {
      const { runner, generateText } = runnerReturning("summary");
      await expect(
        (await getCompactionStrategy("task-handoff"))!.compact({
          ...base,
          model,
          runner,
          options: { maxSummaryTokens },
        }),
      ).rejects.toThrow("positive safe integer");
      expect(generateText).not.toHaveBeenCalled();
    },
  );

  it("accepts the estimate boundary and rejects one character over, without truncating", async () => {
    const strategy = (await getCompactionStrategy("task-handoff"))!;
    // The fixed wrapper is 61 UTF-16 characters; 67 + 61 = 128 = 32 * 4.
    await expect(
      strategy.compact({
        ...base,
        model,
        ...runnerReturning("x".repeat(67)),
        options: { maxSummaryTokens: 32 },
      }),
    ).resolves.toMatchObject({ estimatedSummaryTokens: 32 });
    await expect(
      strategy.compact({
        ...base,
        model,
        ...runnerReturning("x".repeat(68)),
        options: { maxSummaryTokens: 32 },
      }),
    ).rejects.toThrow("exceeds");
  });

  it.each(["task-handoff", "through-line-and-facts"])(
    "%s fails without mutation when unavailable, empty or throwing",
    async (id) => {
      const strategy = (await getCompactionStrategy(id))!;
      await expect(strategy.compact(base)).rejects.toThrow(
        "requires model and runner",
      );
      const interaction = new Interaction(
        model,
        new Stimulus({ role: "assistant" }),
      );
      for (const message of messages.slice(1)) interaction.addMessage(message);
      interaction.setCheckpoint();
      const before = structuredClone(interaction.getMessages());
      const checkpoint = interaction.getCheckpoint();
      const updated = interaction.metadata.updated;
      const { runner, generateText } = runnerReturning(" \n ");
      vi.spyOn(interaction, "getRunner").mockReturnValue(runner);
      await expect(
        interaction.compactContext(id, { fromCheckpoint: false }),
      ).rejects.toThrow("empty summary");
      generateText.mockRejectedValueOnce(new Error("offline"));
      await expect(
        interaction.compactContext(id, { fromCheckpoint: false }),
      ).rejects.toThrow("offline");
      expect(interaction.getMessages()).toEqual(before);
      expect(interaction.getCheckpoint()).toBe(checkpoint);
      expect(interaction.metadata.updated).toBe(updated);
    },
  );
});
