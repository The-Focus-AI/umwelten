import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DialogueEvent } from "@umwelten/core/dialogue/types.js";

/**
 * The partner and the extractor are the only parts that talk to a model, so
 * they're stubbed here; everything else — round shape, question advance,
 * resume — is the real Dialogue + ScriptedRoundPolicy.
 */
const stub = vi.hoisted(() => ({
  replies: [] as string[],
  perceived: [] as string[][],
  extractCalls: [] as string[],
  /** When set, the partner's turn blocks until this resolves. */
  gate: null as Promise<void> | null,
}));

vi.mock("./partner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./partner.js")>();
  class FakePartner {
    readonly id = "partner";
    readonly displayName = "Alex";
    readonly kind = "model" as const;
    readonly model = "test/fake";
    private turn = 0;
    getMessages() {
      return [{ role: "system" as const, content: "persona" }];
    }
    async takeTurn(newEvents: DialogueEvent[]) {
      stub.perceived.push(newEvents.map((e) => e.content));
      if (stub.gate) await stub.gate;
      const reply = stub.replies[this.turn] ?? `reply ${this.turn}`;
      this.turn += 1;
      return { content: reply };
    }
  }
  return {
    ...actual,
    ConnectionPartner: FakePartner,
    extractConnectionMemory: async (opts: { transcript: string }) => {
      stub.extractCalls.push(opts.transcript);
      return { you: ["Answers carefully."], them: [], connection: [] };
    },
  };
});

const { ConnectionQuiz } = await import("./quiz.js");
const { mergeMemory } = await import("./partner.js");

const model = { provider: "ollama", name: "gemma4:26b" };
const quiet = () => {};

beforeEach(() => {
  stub.replies = [];
  stub.perceived = [];
  stub.extractCalls = [];
  stub.gate = null;
});

describe("ConnectionQuiz", () => {
  it("starts on question 1 waiting for the human", () => {
    const quiz = ConnectionQuiz.create("s1", model);
    const view = quiz.publicView();
    expect(view.phase).toBe("interview");
    expect(view.questionIndex).toBe(0);
    expect(view.step).toBe("human-open");
    expect(view.totalQuestions).toBe(36);
    const question = view.events.find((e) => e.role === "question");
    expect(question?.text).toContain("dinner guest");
    expect(question?.label).toBe("Question 1");
  });

  it("runs the scripted round and moves to the next question", async () => {
    stub.replies = ["Unfinished conversations, I think.", "I'll remember that."];
    const quiz = ConnectionQuiz.create("s1", model);

    await quiz.answer("My grandmother.", quiet);
    expect(quiz.publicView().step).toBe("human-followup");

    await quiz.answer("Yes — I never got to ask her.", quiet);
    const view = quiz.publicView();
    expect(view.questionIndex).toBe(1);
    expect(view.step).toBe("human-open");
    expect(view.events.filter((e) => e.role === "question").at(-1)?.text).toContain(
      "famous",
    );
  });

  it("extracts memory once per round, over the whole exchange", async () => {
    stub.replies = ["Reflecting.", "Closing."];
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.answer("My grandmother.", quiet);
    expect(stub.extractCalls).toHaveLength(0);

    await quiz.answer("I never got to ask her.", quiet);
    expect(stub.extractCalls).toHaveLength(1);
    expect(stub.extractCalls[0]).toContain("My grandmother.");
    expect(stub.extractCalls[0]).toContain("Closing.");
    expect(quiz.publicView().memory.you).toEqual(["Answers carefully."]);
  });

  it("gives the partner the question and the human's answer to perceive", async () => {
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.answer("My grandmother.", quiet);
    const firstTurn = stub.perceived[0].join("\n");
    expect(firstTurn).toContain("dinner guest");
    expect(firstTurn).toContain("My grandmother.");
  });

  it("streams partner activity to the sink", async () => {
    stub.replies = ["Reflecting."];
    const quiz = ConnectionQuiz.create("s1", model);
    const events: Record<string, unknown>[] = [];
    await quiz.answer("My grandmother.", (e) => events.push(e));
    expect(events.map((e) => e.type)).toContain("partner-start");
    expect(events.find((e) => e.type === "partner-start")?.mode).toBe("reflect");
    expect(events.find((e) => e.type === "partner")?.text).toBe("Reflecting.");
  });

  it("refuses an answer while the partner still has the floor", async () => {
    let release = () => {};
    stub.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const quiz = ConnectionQuiz.create("s1", model);
    const pending = quiz.answer("first", quiet);
    await expect(quiz.answer("second", quiet)).rejects.toThrow(/already in flight/);
    release();
    await pending;
    expect(quiz.publicView().step).toBe("human-followup");
  });

  it("refuses an empty answer", async () => {
    const quiz = ConnectionQuiz.create("s1", model);
    await expect(quiz.answer("   ", quiet)).rejects.toThrow(/cannot be empty/);
  });

  it("skips a question without answering it", async () => {
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.skip();
    const view = quiz.publicView();
    expect(view.questionIndex).toBe(1);
    expect(view.step).toBe("human-open");
    expect(view.events.some((e) => e.text === "Moving on.")).toBe(true);
  });

  it("resumes mid-round on the slot it left off", async () => {
    stub.replies = ["Reflecting."];
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.answer("My grandmother.", quiet);
    expect(quiz.publicView().step).toBe("human-followup");

    const resumed = ConnectionQuiz.resume(quiz.snapshot());
    expect(resumed.publicView().step).toBe("human-followup");
    expect(resumed.publicView().events).toEqual(quiz.publicView().events);
  });

  it("resumes at a round boundary waiting for a fresh answer", async () => {
    stub.replies = ["Reflecting.", "Closing."];
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.answer("My grandmother.", quiet);
    await quiz.answer("More detail.", quiet);

    const resumed = ConnectionQuiz.resume(quiz.snapshot());
    const view = resumed.publicView();
    expect(view.step).toBe("human-open");
    expect(view.questionIndex).toBe(1);
  });

  it("enters the companion phase after the last question", async () => {
    stub.replies = ["Reflecting.", "Closing.", "Good to still be here."];
    const quiz = ConnectionQuiz.create("s1", model);
    // Jump to the final question through the public surface.
    for (let i = 0; i < 35; i++) await quiz.skip();
    expect(quiz.publicView().questionIndex).toBe(35);

    await quiz.answer("My last answer.", quiet);
    await quiz.answer("And a follow-up.", quiet);

    const view = quiz.publicView();
    expect(view.phase).toBe("companion");
    expect(view.step).toBe("companion");
    // Alex speaks first once the interview ends.
    expect(view.events.at(-1)?.role).toBe("partner");
  });

  it("keeps talking in the companion phase", async () => {
    stub.replies = ["Reflecting.", "Closing.", "Greeting.", "Still here."];
    const quiz = ConnectionQuiz.create("s1", model);
    for (let i = 0; i < 35; i++) await quiz.skip();
    await quiz.answer("My last answer.", quiet);
    await quiz.answer("And a follow-up.", quiet);

    await quiz.answer("So what now?", quiet);
    const view = quiz.publicView();
    expect(view.step).toBe("companion");
    expect(view.events.at(-1)?.text).toBe("Still here.");
    await expect(quiz.skip()).rejects.toThrow(/Nothing to skip/);
  });

  it("keeps the partner's private context out of the public view", async () => {
    stub.replies = ["Reflecting."];
    const quiz = ConnectionQuiz.create("s1", model);
    await quiz.answer("My grandmother.", quiet);
    const view = quiz.publicView() as Record<string, unknown>;
    expect(view).not.toHaveProperty("committedPartnerMessages");
    expect(view).not.toHaveProperty("entries");
    expect(quiz.snapshot().committedPartnerMessages).toBeDefined();
  });

  it("merges memory without duplicates", () => {
    const memory = { you: [], them: [], connection: [] };
    mergeMemory(memory, {
      you: ["Values honesty.", "values honesty."],
      them: ["Curious about family history."],
    });
    mergeMemory(memory, { you: ["Values honesty."] });
    expect(memory.you).toEqual(["Values honesty."]);
    expect(memory.them).toHaveLength(1);
    expect(memory.connection).toHaveLength(0);
  });
});
