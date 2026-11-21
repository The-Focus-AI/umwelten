#!/usr/bin/env node
/**
 * `@umwelten/pi` Extension Demo — Cross-Harness Session Sensemaking & Promotion.
 *
 * Shows how `umweltenPiExtension` plugs into `@earendil-works/pi-coding-agent`
 * (`pi install ./packages/pi`) to search sessions across Pi JSONL v3, Pi Durable
 * SQLite, Claude Code, and Cursor, project Explorations, and promote distilled
 * knowledge into `FACTS.md` / `AGENTS.md`.
 *
 * Run: pnpm tsx examples/pi-extension/demo.ts
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, createModels } from "@earendil-works/pi-ai";
import { umweltenPiExtension } from "@umwelten/pi";
import { DurableHabitat } from "@umwelten/habitat";
import { initializeAdapters, projectSessions } from "@umwelten/sessions";

const workspace = await mkdtemp(join(tmpdir(), "umwelten-pi-demo-"));

try {
  // 1. Seed a durable Pi Durable SQLite conversation inside the project workspace
  const faux = fauxProvider({ provider: "faux", models: [{ id: "demo-1" }] });
  faux.setResponses([
    fauxAssistantMessage("Always run `pnpm test:run` instead of watch-mode `pnpm test`."),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);

  const habitat = await DurableHabitat.open({
    id: "repo-assistant",
    workDir: workspace,
    models,
    model: { provider: "faux", modelId: "demo-1" },
  });
  await habitat.ask("How should tests run in CI?");
  await habitat.close();

  // 2. Project discovered Source Sessions (including pi-durable SQLite) into Explorations
  initializeAdapters();
  const projected = await projectSessions(workspace);
  console.log(
    `Discovered ${projected.explorations.length} Exploration(s):`,
    projected.explorations.map((e) => ({ id: e.id, name: e.name })),
  );

  // 3. Load `umweltenPiExtension` onto a mock Pi ExtensionAPI host and promote a fact
  const tools = new Map<string, any>();
  umweltenPiExtension({
    registerTool: (t: any) => tools.set(t.name, t),
    registerCommand: () => undefined,
  } as any);

  const promote = tools.get("umwelten_promote_knowledge");
  await promote.execute(
    "call-1",
    {
      target: "project-fact",
      title: "CI test runner",
      content: "Run `pnpm test:run` (never watch-mode `pnpm test`) in automation.",
    },
    undefined,
    undefined,
    { cwd: workspace },
  );

  console.log("\nPromoted FACTS.md:\n" + (await readFile(join(workspace, "FACTS.md"), "utf8")));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
