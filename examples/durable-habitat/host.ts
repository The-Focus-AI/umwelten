#!/usr/bin/env node
/**
 * Host-Agnostic `DurableHabitat` & `HabitatHost` Demo (`@earendil-works/pi-durable`).
 *
 * Multiplexes stateful SQLite-backed Habitats on a single Node HTTP server with:
 *   - Owned read/write vs. Mounted read-only repository guards (`ToolTask` hook)
 *   - Turn Fan-out `Annotation` probes
 *   - `ui://` UI resource publication (`ConversationUIResourcesDoc`)
 *   - A2A 1.0 JSON-RPC + Agent Card serving (`@leocavalcante/pi-a2a/durable`)
 *
 * Run: pnpm tsx examples/durable-habitat/host.ts
 */

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { HabitatHost } from "@umwelten/habitat";

const dataDir = await mkdtemp(join(tmpdir(), "umwelten-durable-host-"));
const faux = fauxProvider({ provider: "faux", models: [{ id: "habitat-v1" }] });
faux.setResponses([
  fauxAssistantMessage("Hello from a SQLite-backed DurableHabitat over A2A 1.0!"),
]);

const host = new HabitatHost({
  dataDir,
  defaultModel: { provider: "faux", modelId: "habitat-v1" },
  modelsFactory: () => {
    const m = createModels();
    m.setProvider(faux.provider);
    return m;
  },
});

const httpHandler = host.createHttpHandler((id) => ({
  name: `Habitat ${id}`,
  publicOrigin: `http://127.0.0.1:0/habitats/${id}`,
}));

const server = createServer((req, res) => {
  void httpHandler(req, res);
});

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;

try {
  // 1. Discover the Habitat's A2A 1.0 Agent Card
  const cardRes = await fetch(
    `http://127.0.0.1:${port}/habitats/research/.well-known/agent-card.json`,
  );
  const card = (await cardRes.json()) as { name: string };
  console.log("Agent Card:", card.name);

  // 2. Send an A2A 1.0 `SendMessage` JSON-RPC request
  const rpcRes = await fetch(`http://127.0.0.1:${port}/habitats/research/a2a`, {
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
          messageId: "msg-1",
          role: "ROLE_USER",
          parts: [{ text: "Ping DurableHabitat!" }],
        },
      },
    }),
  });
  const rpcBody = await rpcRes.json();
  console.log("A2A 1.0 Task Result:", JSON.stringify(rpcBody, null, 2));
} finally {
  server.close();
  await host.closeAll();
  await rm(dataDir, { recursive: true, force: true });
}
