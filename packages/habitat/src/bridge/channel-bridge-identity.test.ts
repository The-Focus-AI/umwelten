/**
 * Unit tests for per-user identity in ChannelBridge (ADR 0003 step 2):
 * - userId is set on EVERY message (the current speaker), not just at
 *   entry creation, so multi-speaker threads attribute per turn;
 * - a thread with >1 speaker labels each user turn;
 * - a single-speaker thread is unchanged (no label);
 * - the participant set is persisted to session metadata.
 *
 * Interaction is mocked so the default path doesn't hit a real LLM.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shape we assert against (the real class is defined inside the mock factory).
interface FakeInteractionShape {
  userId: string;
  messages: Array<{ role: string; content: unknown }>;
  userIdAtGeneration: string[];
}

// Capture every Interaction the bridge constructs, plus the userId observed
// at each streamText (i.e. at generation time, per turn). Declared via
// vi.hoisted so it's available inside the hoisted vi.mock factory.
const { instances } = vi.hoisted(() => ({
  instances: [] as FakeInteractionShape[],
}));

vi.mock("@umwelten/core/interaction/core/interaction.js", () => {
  class FakeInteraction {
    userId = "default";
    modelDetails: unknown;
    messages: Array<{ role: string; content: unknown }> = [];
    onTranscriptUpdate: ((m: unknown) => void) | undefined;
    userIdAtGeneration: string[] = [];
    constructor(modelDetails: unknown, _stimulus: unknown) {
      this.modelDetails = modelDetails;
      instances.push(this);
    }
    addMessage(m: { role: string; content: unknown }) {
      this.messages.push(m);
    }
    getMessages() {
      return this.messages;
    }
    setOnTranscriptUpdate(cb: (m: unknown) => void) {
      this.onTranscriptUpdate = cb;
    }
    async streamText() {
      this.userIdAtGeneration.push(this.userId);
      return { content: "reply", metadata: undefined };
    }
  }
  return { Interaction: FakeInteraction };
});

import { ChannelBridge } from "./channel-bridge.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import type { AgentHost } from "../types.js";

async function makeFixture() {
  const workDir = await mkdtemp(join(tmpdir(), "bridge-identity-"));
  const sessionDir = join(workDir, "sessions", "sess-1");
  await mkdir(sessionDir, { recursive: true });
  // Empty routing → resolves to the main persona on the default runtime.
  await writeFile(join(workDir, "routing.json"), JSON.stringify({ channels: {} }));

  const updateSessionMetadata = vi.fn(async () => {});
  const host = {
    workDir,
    getDefaultModelDetails: () => ({ name: "test-model", provider: "test" }),
    getStimulus: async () => new Stimulus({ role: "test assistant" }),
    getAgents: () => [],
    getAgent: () => undefined,
    getOrCreateSession: async () => ({ sessionId: "sess-1", sessionDir }),
    updateSessionMetadata,
  } as unknown as AgentHost;

  return { host, sessionDir, updateSessionMetadata };
}

describe("ChannelBridge per-user identity (ADR 0003 step 2)", () => {
  it("single-speaker thread: userId set, no labeling", async () => {
    instances.length = 0;
    const { host } = await makeFixture();
    const bridge = new ChannelBridge(host, {});

    await bridge.handleMessage(
      { channelKey: "a2a:ctx-1", text: "hello", userId: "u1" },
      { onDone: () => {} },
    );
    await bridge.handleMessage(
      { channelKey: "a2a:ctx-1", text: "again", userId: "u1" },
      { onDone: () => {} },
    );

    // Same channelKey → one cached interaction.
    expect(instances).toHaveLength(1);
    const i = instances[0];
    expect(i.userId).toBe("u1");
    // No labels for a single speaker.
    expect(i.messages.map((m) => m.content)).toEqual(["hello", "again"]);
  });

  it("multi-speaker thread: per-turn userId + labeled turns", async () => {
    instances.length = 0;
    const { host, updateSessionMetadata } = await makeFixture();
    const bridge = new ChannelBridge(host, {});

    await bridge.handleMessage(
      { channelKey: "a2a:ctx-2", text: "hi", userId: "u1" },
      { onDone: () => {} },
    );
    await bridge.handleMessage(
      {
        channelKey: "a2a:ctx-2",
        text: "my turn",
        userId: "u2",
        displayName: "Bob",
      },
      { onDone: () => {} },
    );

    expect(instances).toHaveLength(1);
    const i = instances[0];

    // userId reflects the CURRENT speaker at each generation, not the creator.
    expect(i.userIdAtGeneration).toEqual(["u1", "u2"]);
    expect(i.userId).toBe("u2");

    // Second speaker's turn is labeled (by displayName); first stays bare.
    expect(i.messages.map((m) => m.content)).toEqual(["hi", "[Bob]: my turn"]);

    // Participant set persisted to session metadata.
    expect(updateSessionMetadata).toHaveBeenCalledWith("sess-1", {
      metadata: { participants: ["u1", "u2"] },
    });
  });

  it("labels by userId when no displayName is given", async () => {
    instances.length = 0;
    const { host } = await makeFixture();
    const bridge = new ChannelBridge(host, {});

    await bridge.handleMessage(
      { channelKey: "a2a:ctx-3", text: "one", userId: "alice" },
      { onDone: () => {} },
    );
    await bridge.handleMessage(
      { channelKey: "a2a:ctx-3", text: "two", userId: "bob" },
      { onDone: () => {} },
    );

    const i = instances[0];
    expect(i.messages.map((m) => m.content)).toEqual(["one", "[bob]: two"]);
  });
});
