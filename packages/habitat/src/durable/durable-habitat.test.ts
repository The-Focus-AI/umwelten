import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { z } from "zod";
import { tool } from "@umwelten/pi";
import {
  DurableHabitat,
  HabitatHost,
} from "./index.js";

describe("DurableHabitat & HabitatHost (pi-durable)", () => {
  let rootDir: string;
  let httpServer: Server | undefined;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "umwelten-durable-habitat-"));
  });

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
    await rm(rootDir, { recursive: true, force: true });
  });

  function modelsWithFaux(faux: ReturnType<typeof fauxProvider>) {
    const models = createModels();
    models.setProvider(faux.provider);
    return models;
  }

  it("persists turns to SQLite, recovers across reopen, and forks without mutating parent history", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      fauxAssistantMessage("First committed answer."),
      fauxAssistantMessage("Branch B answer."),
      fauxAssistantMessage("Parent second answer."),
    ]);

    const workDir = join(rootDir, "agent-a");
    const habitat1 = await DurableHabitat.open({
      id: "agent-a",
      workDir,
      models: modelsWithFaux(faux),
      model: { provider: "faux", modelId: "faux-1" },
      instructions: "You are a durable test agent.",
    });

    const first = await habitat1.ask("Remember alpha.");
    expect(first.text).toBe("First committed answer.");
    expect(first.answerEntryId).toBeDefined();
    await habitat1.close();

    // Reopen from the same SQLite file and fork from the first answer
    const habitat2 = await DurableHabitat.open({
      id: "agent-a",
      workDir,
      models: modelsWithFaux(faux),
      model: { provider: "faux", modelId: "faux-1" },
    });

    const forkedConv = await habitat2.fork(first.answerEntryId!);
    const branchTurn = await habitat2.ask("Go down branch B.", {
      conversation: forkedConv,
    });
    expect(branchTurn.text).toBe("Branch B answer.");

    const parentTurn = await habitat2.ask("Continue on main branch.");
    expect(parentTurn.text).toBe("Parent second answer.");

    const rootConv = await habitat2.root();
    const rootPage = await rootConv.entries(
      { order: "ascending" },
      50,
      undefined,
      undefined as any,
    );
    const serializedRoot = JSON.stringify(rootPage.items);
    expect(serializedRoot).toContain("Parent second answer.");
    expect(serializedRoot).not.toContain("Branch B answer.");

    await habitat2.close();
  });

  it("enforces Owned read/write vs Mounted read-only repository scopes on CodingTools", async () => {
    const ownedDir = join(rootDir, "owned-repo");
    const mountedDir = join(rootDir, "mounted-readonly");
    const outsideDir = join(rootDir, "outside-secret");
    await mkdir(ownedDir, { recursive: true });
    await mkdir(mountedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(mountedDir, "README.md"), "Read-only reference docs");
    await writeFile(join(outsideDir, "secret.txt"), "top-secret");

    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      // 1) Read mounted repo (allowed), write owned repo (allowed), write mounted repo (blocked), read outside (blocked)
      fauxAssistantMessage(
        [
          fauxToolCall("read", { path: join(mountedDir, "README.md") }, { id: "c1" }),
          fauxToolCall(
            "write",
            { path: join(ownedDir, "notes.txt"), content: "written ok" },
            { id: "c2" },
          ),
          fauxToolCall(
            "write",
            { path: join(mountedDir, "hack.txt"), content: "nope" },
            { id: "c3" },
          ),
          fauxToolCall("read", { path: join(outsideDir, "secret.txt") }, { id: "c4" }),
        ],
        { stopReason: "toolUse" },
      ),
      (ctx) => {
        const toolResults = ctx.messages.filter((m) => m.role === "toolResult");
        const summary = toolResults
          .map((tr) => `${tr.toolCallId}:${tr.isError ? "ERR" : "OK"}`)
          .join(",");
        return fauxAssistantMessage(summary);
      },
    ]);

    const habitat = await DurableHabitat.open({
      id: "scoped-coder",
      models: modelsWithFaux(faux),
      model: { provider: "faux", modelId: "faux-1" },
      env: "local",
      ownedRepoRoot: ownedDir,
      mountedReadOnlyRoots: [mountedDir],
    });

    const res = await habitat.ask("Test repository boundaries");
    expect(res.text).toBe("c1:OK,c2:OK,c3:ERR,c4:ERR");
    expect(await readFile(join(ownedDir, "notes.txt"), "utf8")).toBe("written ok");

    await habitat.close();
  });

  it("runs Turn Fan-out Annotation probes and UI resource tools durably", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "publish_ui_resource",
            { uri: "ui://metrics/card", html: "<div>42% lift</div>" },
            { id: "ui-1" },
          ),
          fauxToolCall("double_number", { n: 21 }, { id: "math-1" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Published the card; 21 doubled is 42."),
    ]);

    const habitat = await DurableHabitat.open({
      id: "fanout-ui-agent",
      models: modelsWithFaux(faux),
      model: { provider: "faux", modelId: "faux-1" },
      tools: {
        double_number: tool({
          description: "Double an integer",
          inputSchema: z.object({ n: z.number() }),
          execute: async ({ n }) => ({ doubled: n * 2 }),
        }),
      },
      fanout: {
        annotations: [
          {
            id: "intent-tag",
            evaluate: ({ lastUserText, lastAssistantText }) =>
              `user=${lastUserText.length};asst=${lastAssistantText.includes("42")}`,
          },
        ],
      },
    });

    const reply = await habitat.ask("Show metrics card");
    expect(reply.text).toContain("42");

    const annotations = await habitat.getAnnotations("intent-tag");
    expect(annotations?.items).toHaveLength(1);
    expect(annotations?.items[0].value).toBe("user=17;asst=true");

    const uiDoc = await habitat.getUIResources();
    expect(uiDoc?.resources).toHaveLength(1);
    expect((uiDoc?.resources[0] as { uri?: string }).uri).toBe(
      "ui://metrics/card",
    );

    await habitat.close();
  });

  it("multiplexes Habitats in HabitatHost, evicts idle instances, and serves A2A 1.0 over HTTP", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([
      fauxAssistantMessage("Pong from A2A Habitat!"),
      fauxAssistantMessage("Still alive after eviction!"),
    ]);

    const host = new HabitatHost({
      dataDir: join(rootDir, "fleet"),
      idleEvictMs: 10,
      modelsFactory: () => modelsWithFaux(faux),
    });

    host.register("twitter-agent", {
      name: "Twitter Agent",
      description: "Zero-container API Habitat",
      model: { provider: "faux", modelId: "faux-1" },
    });

    const twitter = await host.get("twitter-agent");
    expect(host.listOpenIds()).toEqual(["twitter-agent"]);

    const surface = twitter.createA2ASurface({
      endpointUrl: "http://127.0.0.1/a2a",
      allowUnauthenticatedLoopback: true,
    });

    httpServer = createServer(async (req, res) => {
      const handled = await surface.httpHandler(req, res);
      if (!handled) {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      httpServer!.listen(0, "127.0.0.1", resolve),
    );
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Agent Card discovery
    const cardRes = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as { name: string };
    expect(card.name).toBe("Twitter Agent");

    // 2. Send A2A 1.0 JSON-RPC message and wait for the settled task answer
    const rpcRes = await fetch(`${baseUrl}/a2a`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "a2a-version": "1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "msg-101",
            role: "ROLE_USER",
            parts: [{ text: "Ping over A2A" }],
          },
        },
      }),
    });
    expect(rpcRes.status).toBe(200);
    const rpcBody = (await rpcRes.json()) as {
      result?: { task?: { id: string } };
    };
    const taskId = rpcBody.result?.task?.id;
    expect(taskId).toBeTruthy();

    // Poll GetTask until settled
    let taskText = "";
    for (let i = 0; i < 20; i++) {
      const getRes = await fetch(`${baseUrl}/a2a`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "a2a-version": "1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `get-${i}`,
          method: "GetTask",
          params: { id: taskId },
        }),
      });
      const getBody = await getRes.json();
      const serialized = JSON.stringify(getBody);
      if (serialized.includes("Pong from A2A Habitat!")) {
        taskText = serialized;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(taskText).toContain("Pong from A2A Habitat!");

    await surface.adapter.close();
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = undefined;

    // 3. Evict idle Habitat from RAM, then reopen transparently on next request
    const evicted = await host.evictIdle(Date.now() + 1_000);
    expect(evicted).toEqual(["twitter-agent"]);
    expect(host.listOpenIds()).toEqual([]);

    const reopened = await host.get("twitter-agent");
    const second = await reopened.ask("Wake back up");
    expect(second.text).toBe("Still alive after eviction!");

    await host.closeAll();
  });
});
