import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AdapterRegistry } from "./adapter.js";
import { PiDurableSessionAdapter } from "./pi-durable-adapter.js";
import { projectSessions } from "../projection/projector.js";

describe("PiDurableSessionAdapter → Exploration projection", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "umwelten-pi-durable-adapter-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("discovers root and forked pi-durable SQLite conversations and projects them as Explorations", async () => {
    const dbPath = join(dir, "habitat.sqlite");
    const storage = await openNodeSqliteStorage(dbPath);

    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("lookup_fact", { topic: "mycel" }, { id: "tc-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Mycel settles in micro-dollars."),
      fauxAssistantMessage("Forked exploration into supplier headroom."),
    ]);

    const models = createModels();
    models.setProvider(faux.provider);

    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "test.tools",
        tools: [
          defineTool({
            name: "lookup_fact",
            description: "Look up a project fact",
            parameters: {
              type: "object",
              properties: { topic: { type: "string" } },
              required: ["topic"],
            },
            async execute(args) {
              return {
                output: [
                  {
                    type: "text",
                    text: `Fact for ${(args as { topic: string }).topic}: integer micro-dollars`,
                  },
                ],
              };
            },
          }),
        ],
      }),
    );

    const harness = await Harness.open(
      storage,
      { models, registry },
      BACKGROUND_CONTEXT,
    );
    const root = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });

    const sub1 = await root.submit(
      { type: "input", content: "How does Mycel handle money?", whenBusy: "followUp" },
      BACKGROUND_CONTEXT,
    );
    await sub1.wait(BACKGROUND_CONTEXT);
    await root.waitForIdle(BACKGROUND_CONTEXT);

    const entriesPage = await root.entries(
      { order: "descending" },
      10,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const answerEntry = entriesPage.items.find((e) => AssistantEntry.is(e))!;

    const forked = await root.fork(
      answerEntry.id,
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      },
      BACKGROUND_CONTEXT,
    );
    const sub2 = await forked.submit(
      { type: "input", content: "Now branch into supplier headroom.", whenBusy: "followUp" },
      BACKGROUND_CONTEXT,
    );
    await sub2.wait(BACKGROUND_CONTEXT);
    await forked.waitForIdle(BACKGROUND_CONTEXT);

    await harness.close(BACKGROUND_CONTEXT);

    // Discover and project through PiDurableSessionAdapter
    const adapter = new PiDurableSessionAdapter({ storeDir: dir });
    const discovered = await adapter.discoverSessions({ projectPath: dir });
    expect(discovered.totalCount).toBe(2);

    const fullFork = await adapter.getSession(discovered.sessions[0].id);
    expect(fullFork).not.toBeNull();
    expect(fullFork!.metrics.toolCalls).toBeGreaterThanOrEqual(1);

    const adapterReg = new AdapterRegistry();
    adapterReg.register(adapter);
    const projected = await projectSessions(dir, { registry: adapterReg });
    expect(projected.explorations).toHaveLength(2);
    expect(projected.sources[0].source).toBe("pi-durable");
  });
});
