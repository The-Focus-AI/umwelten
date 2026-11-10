import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type {
  ModelRunner,
  ModelResponse,
  StreamObserver,
} from "@umwelten/core/cognition/types.js";
import { CollaborationRun } from "./runtime.js";
import { CollaborationStore } from "@umwelten/core/collaboration/store.js";

const model = { provider: "test", name: "scripted" };
const response = (content = ""): ModelResponse => ({
  content,
  metadata: {
    startTime: new Date(),
    endTime: new Date(),
    provider: "test",
    model: "scripted",
    tokenUsage: { promptTokens: 41, completionTokens: 7, total: 48 },
  },
});
async function invoke(
  ix: Interaction,
  name: string,
  input: unknown,
  observer?: StreamObserver,
) {
  const t = ix.tools![name];
  const args = t.inputSchema.parse(input);
  const toolCallId = `${name}-${ix.messages.length}`;
  ix.addMessage({
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName: name, input: args }],
  });
  observer?.onToolCall?.({ toolCallId, toolName: name, input: args });
  const output = await t.execute(args, { toolCallId, messages: ix.messages });
  ix.addMessage({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName: name,
        output: { type: "json", value: output },
      },
    ],
  });
  observer?.onToolResult?.({
    toolCallId,
    toolName: name,
    output,
    isError: false,
  });
  return output;
}
function scripted(
  fn: (
    ix: Interaction,
    turn: number,
    observer?: StreamObserver,
  ) => Promise<void>,
): ModelRunner {
  const counts = new Map<string, number>();
  return {
    async streamText(ix: Interaction, _signal, observer) {
      expect(ix.maxSteps).toBe(1);
      const turn = (counts.get(ix.id) ?? 0) + 1;
      counts.set(ix.id, turn);
      await fn(ix, turn, observer);
      return response();
    },
    async generateText(ix: Interaction) {
      ix.addMessage({
        role: "assistant",
        content: "Goal: test. Evidence: result.txt. Pending: verify 17.",
      });
      return response("Goal: test. Evidence: result.txt. Pending: verify 17.");
    },
    async generateObject() {
      throw new Error("unused");
    },
    async streamObject() {
      throw new Error("unused");
    },
  };
}
const dirs: string[] = [];
const runs: CollaborationRun[] = [];
async function setup(runner: ModelRunner, limits = {}) {
  const dir = await mkdtemp(join(tmpdir(), "collaboration-test-"));
  dirs.push(dir);
  const run = new CollaborationRun(dir, { runner, limits });
  runs.push(run);
  return { run, dir };
}
afterEach(async () => {
  for (const run of runs.splice(0)) await run.close();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe("collaboration runtime", () => {
  it("waits without polling, wakes on a direct message, and records exact decision observations", async () => {
    const { run } = await setup(
      scripted(async (ix, turn, observer) => {
        if (turn === 1)
          await invoke(ix, "agent_wait", { channels: [] }, observer);
        else {
          expect(JSON.stringify(ix.messages)).toContain("check 17, not 19");
          await invoke(ix, "agent_finish", { result: "17" }, observer);
        }
      }),
    );
    const id = run.addAgent({ task: "wait", model });
    run.start();
    await run.waitForIdle();
    expect(run.status().calls).toBe(1);
    run.send(null, "channel:other", "invisible");
    await run.waitForIdle();
    expect(run.status().calls).toBe(1);
    run.send(null, id, "check 17, not 19");
    await run.waitForIdle();
    expect(run.status().agents[0].status).toBe("finished");
    const inputs = run.store
      .events()
      .filter((e) => e.kind === "decision.started");
    expect(JSON.stringify(inputs[0])).not.toContain("check 17");
    expect(JSON.stringify(inputs[1])).toContain("check 17");
    const samples = run.store
      .exportTraining({ redact: (v) => v })
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(samples).toHaveLength(2);
    expect(samples[0].target[0].content[0].toolName).toBe("agent_wait");
    expect(samples[1].input.tools.agent_finish.inputSchema).toBeDefined();
  });

  it.each(["fresh", "fork", "summary"] as const)(
    "spawns a %s child with its own model and reports to its parent",
    async (context) => {
      let parent = "";
      let child = "";
      const { run } = await setup(
        scripted(async (ix, turn, observer) => {
          if (ix.id === parent) {
            if (turn === 1) {
              child = (
                await invoke(
                  ix,
                  "agent_spawn",
                  {
                    task: "child-only-task",
                    context,
                    model: { ...model, name: "other" },
                  },
                  observer,
                )
              ).agentId;
            } else if (turn === 2)
              await invoke(ix, "agent_wait", { channels: [] }, observer);
            else
              await invoke(
                ix,
                "agent_finish",
                { result: "parent complete" },
                observer,
              );
          } else {
            expect(ix.modelDetails.name).toBe("other");
            const history = JSON.stringify(ix.messages);
            expect(history).toContain("child-only-task");
            if (context === "fresh")
              expect(history).not.toContain("parent-secret-fact");
            if (context === "fork")
              expect(history).toContain("parent-secret-fact");
            if (context === "summary")
              expect(history).toContain("Pending: verify 17");
            // Snapshot was before the parent's current spawn tool call, so no dangling call is inherited.
            expect(history).not.toContain('"type":"tool-call"');
            await invoke(
              ix,
              "agent_finish",
              { result: "child found 17" },
              observer,
            );
          }
        }),
        { concurrency: 1 },
      );
      parent = run.addAgent({ task: "parent-secret-fact", model });
      run.start();
      await run.waitForIdle();
      expect(run.status().agents.find((a) => a.id === child)?.parentId).toBe(
        parent,
      );
      // A completion arriving before wait was already delivered; inject a new wake if parent is waiting.
      if (
        run.status().agents.find((a) => a.id === parent)?.status === "waiting"
      ) {
        run.send(null, parent, "complete now");
        await run.waitForIdle();
      }
      expect(run.status().agents.every((a) => a.status === "finished")).toBe(
        true,
      );
      expect(run.store.events().some((e) => e.kind === "agent.spawned")).toBe(
        true,
      );
      const calls = run.store
        .events()
        .filter((e) => e.kind === "call.completed");
      expect(
        calls.every((e) => e.agentId === parent || e.agentId === child),
      ).toBe(true);
      expect(calls.every((e) => !Object.hasOwn(e.data as object, "cost"))).toBe(
        true,
      );
      if (context === "summary") {
        expect(
          run.store.events().filter((e) => e.kind === "summary.completed"),
        ).toHaveLength(1);
        expect(calls.filter((e) => e.agentId === parent)).toHaveLength(4);
      }
    },
  );

  it("does not lose a message arriving while the receiver is still deciding to wait", async () => {
    let receiver = "";
    const { run } = await setup(
      scripted(async (ix, turn, observer) => {
        if (turn === 1) {
          run.send(null, receiver, "arrived mid-turn");
          await invoke(ix, "agent_wait", { channels: [] }, observer);
        } else {
          expect(JSON.stringify(ix.messages)).toContain("arrived mid-turn");
          await invoke(ix, "agent_finish", { result: "received" }, observer);
        }
      }),
    );
    receiver = run.addAgent({ task: "wait", model });
    run.start();
    await run.waitForIdle();
    expect(run.status().calls).toBe(2);
  });

  it("uses fair scheduling and runs distinct agents concurrently, never the same agent twice", async () => {
    const running = new Set<string>();
    let peak = 0;
    const order: string[] = [];
    const { run } = await setup(
      scripted(async (ix, turn, observer) => {
        expect(running.has(ix.id)).toBe(false);
        running.add(ix.id);
        order.push(ix.id);
        peak = Math.max(peak, running.size);
        await new Promise((r) => setTimeout(r, 5));
        if (turn === 2)
          await invoke(ix, "agent_finish", { result: "done" }, observer);
        else ix.addMessage({ role: "assistant", content: "continue" });
        running.delete(ix.id);
      }),
      { concurrency: 2 },
    );
    const ids = [1, 2, 3].map((i) =>
      run.addAgent({ task: `task ${i}`, model }),
    );
    run.start();
    await run.waitForIdle();
    expect(peak).toBe(2);
    expect(new Set(order.slice(0, 3))).toEqual(new Set(ids));
    expect(run.status().calls).toBe(6);
  });

  it("stops at the global call budget even when agents never yield", async () => {
    const { run } = await setup(
      scripted(async (ix) => {
        ix.addMessage({ role: "assistant", content: "again" });
      }),
      { maxCalls: 3 },
    );
    run.addAgent({ task: "loop", model });
    run.start();
    await run.waitForIdle();
    expect(run.status().calls).toBe(3);
    expect(run.status().stopped).toBe(true);
    expect(run.status().tokens).toBe(144);
  });

  it("rejects extra children and spawn depth while preserving the parent", async () => {
    const { run } = await setup(
      scripted(async (ix, _turn, observer) => {
        await expect(
          invoke(ix, "agent_spawn", { task: "forbidden" }, observer),
        ).rejects.toThrow("depth");
        await invoke(ix, "agent_finish", { result: "bounded" }, observer);
      }),
      { maxAgents: 1, maxDepth: 0 },
    );
    run.addAgent({ task: "root", model });
    expect(() => run.addAgent({ task: "extra", model })).toThrow("Agent limit");
    run.start();
    await run.waitForIdle();
    expect(run.status().agents).toHaveLength(1);
  });

  it("wakes artifact subscribers, enforces CAS, and rejects tools after yielding", async () => {
    const { run } = await setup(
      scripted(async (ix, turn, observer) => {
        if (turn === 1) {
          await invoke(ix, "agent_wait", { channels: ["artifacts"] }, observer);
          await expect(
            invoke(
              ix,
              "agent_publish",
              { path: "bad.txt", content: "bad", expectedVersion: 0 },
              observer,
            ),
          ).rejects.toThrow("yielded");
        } else {
          const result = await invoke(
            ix,
            "agent_read",
            { path: "answer.txt" },
            observer,
          );
          expect(result.artifact.content).toBe("17");
          await invoke(ix, "agent_finish", { result: "verified" }, observer);
        }
      }),
    );
    run.addAgent({ task: "watch", model });
    run.start();
    await run.waitForIdle();
    run.publish(null, "answer.txt", "17", 0);
    expect(() => run.publish(null, "answer.txt", "19", 0)).toThrow("conflict");
    await run.waitForIdle();
    expect(run.status().calls).toBe(2);
    expect(run.store.artifact("bad.txt")).toBeUndefined();
  });

  it("suspends waiting agents and resumes with original budgets and history", async () => {
    const { run, dir } = await setup(
      scripted(async (ix, _turn, observer) => {
        await invoke(ix, "agent_wait", { channels: [] }, observer);
      }),
    );
    const id = run.addAgent({ task: "remember 23", model });
    run.start();
    await run.waitForIdle();
    run.suspend();
    // Simulate a durable message committed before the old process could wake the agent.
    const writer = new CollaborationStore(dir);
    writer.append("message", null, {
      to: id,
      content: "resume from durable inbox",
    });
    writer.close();
    const resumed = new CollaborationRun(dir, {
      resume: true,
      runner: scripted(async (ix, _turn, observer) => {
        expect(JSON.stringify(ix.messages)).toContain("remember 23");
        expect(JSON.stringify(ix.messages)).toContain(
          "resume from durable inbox",
        );
        await invoke(ix, "agent_finish", { result: "resumed" }, observer);
      }),
    });
    runs.push(resumed);
    resumed.start();
    await resumed.waitForIdle();
    expect(resumed.status().calls).toBe(2);
    expect(resumed.status().tokens).toBe(96);
  });

  it.each(["running", "waiting", "finished"])(
    "marks interrupted %s decisions failed instead of replaying their side effects",
    async (status) => {
      const dir = await mkdtemp(join(tmpdir(), "collaboration-recovery-"));
      dirs.push(dir);
      const db = new CollaborationStore(dir);
      db.append("run.created", null, { id: "recovery", limits: {} });
      db.append("decision.started", "interrupted", {
        decisionId: "unfinished",
        messages: [],
      });
      db.putAgent("interrupted", {
        id: "interrupted",
        status,
        task: "x",
        model,
        depth: 0,
        messages: [],
        cursor: 0,
        channels: [],
      });
      db.close();
      const run = new CollaborationRun(dir, {
        resume: true,
        runner: scripted(async () => {
          throw new Error("must not run");
        }),
      });
      runs.push(run);
      run.start();
      await run.waitForIdle();
      expect(run.status().agents[0].status).toBe("failed");
      expect(run.status().calls).toBe(0);
      expect(
        run.store.events().filter((e) => e.kind === "decision.failed"),
      ).toHaveLength(1);
      run.suspend();
      const again = new CollaborationRun(dir, { resume: true });
      runs.push(again);
      expect(
        again.store.events().filter((e) => e.kind === "decision.failed"),
      ).toHaveLength(1);
    },
  );

  it("requires explicit prices for cost budgets and rejects calls exceeding token admission", async () => {
    const { run } = await setup(
      scripted(async () => {
        throw new Error("must not run");
      }),
      { maxCostUsd: 1, maxTotalTokens: 1 },
    );
    expect(() => run.addAgent({ task: "x", model })).toThrow("prices");
    run.addAgent({
      task: "x",
      model: { ...model, costs: { promptTokens: 1, completionTokens: 2 } },
    });
    run.start();
    await run.waitForIdle();
    expect(run.status().calls).toBe(0);
    expect(run.status().stopped).toBe(true);
  });

  it("rejects a second live scheduler but permits a reader", async () => {
    const { run, dir } = await setup(scripted(async () => {}));
    expect(() => new CollaborationRun(dir, { resume: true })).toThrow(
      "live scheduler",
    );
    const reader = new CollaborationStore(dir);
    expect(reader.events()[0].kind).toBe("run.created");
    reader.close();
    run.suspend();
    const resumed = new CollaborationRun(dir, { resume: true });
    runs.push(resumed);
    expect(resumed.id).toBe(run.id);
  });

  it("does not reveal other agents' inboxes, tasks, or instructions through discovery", async () => {
    let first = "";
    const { run } = await setup(
      scripted(async (ix, _turn, observer) => {
        if (ix.id === first) {
          const visible = await invoke(ix, "agent_read", {}, observer);
          expect(JSON.stringify(visible)).not.toContain("private-secret");
          expect(visible.agents).toHaveLength(2);
        }
        await invoke(ix, "agent_finish", { result: "done" }, observer);
      }),
    );
    first = run.addAgent({ task: "reader", model });
    const second = run.addAgent({
      task: "private-secret-task",
      instructions: "private-secret-instructions",
      model,
    });
    run.send(null, second, "private-secret-message");
    run.start();
    await run.waitForIdle();
    expect(run.status().agents.every((a) => a.status === "finished")).toBe(
      true,
    );
  });

  it("never exports an aborted partial response as a successful decision", async () => {
    const runner = scripted(async () => {});
    runner.streamText = async (ix: Interaction) => {
      ix.addMessage({ role: "assistant", content: "unfinished output" });
      return {
        ...response("unfinished output"),
        metadata: { ...response().metadata, partial: true },
      } as ModelResponse;
    };
    const { run } = await setup(runner);
    run.addAgent({ task: "partial", model });
    run.start();
    await run.waitForIdle();
    expect(run.status().agents[0].status).toBe("failed");
    expect(run.store.exportTraining({ redact: (v) => v })).toBe("");
    expect(
      run.store.events().find((e) => e.kind === "call.completed")?.data,
    ).toMatchObject({ estimated: true, failed: true });
  });

  it("deadline aborts an in-flight request and blocks later tool effects", async () => {
    const runner = scripted(async () => {});
    runner.streamText = async (ix: Interaction, signal) => {
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      await expect(
        invoke(ix, "agent_publish", {
          path: "too-late",
          content: "no",
          expectedVersion: 0,
        }),
      ).rejects.toThrow("stopped");
      return response();
    };
    const { run } = await setup(runner, { maxDurationMs: 100 });
    run.addAgent({ task: "wait for deadline", model });
    run.start();
    await run.waitForIdle();
    expect(run.status().stopped).toBe(true);
    expect(run.store.artifact("too-late")).toBeUndefined();
    expect(
      run.store.events().some((e) => e.kind === "decision.completed"),
    ).toBe(false);
  });

  it("charges interrupted reservations once across repeated recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "collaboration-reservation-"));
    dirs.push(dir);
    const db = new CollaborationStore(dir);
    db.append("run.created", null, { id: "recover-cost", limits: {} });
    db.append("call.started", "lost", {
      inputTokens: 123,
      outputTokens: 17,
      costReservation: 0.07,
    });
    db.close();
    const run = new CollaborationRun(dir, { resume: true });
    runs.push(run);
    expect(run.status()).toMatchObject({
      calls: 1,
      tokens: 140,
      costUsd: 0.07,
    });
    run.suspend();
    const again = new CollaborationRun(dir, { resume: true });
    runs.push(again);
    expect(again.status()).toMatchObject({
      calls: 1,
      tokens: 140,
      costUsd: 0.07,
    });
  });
});
