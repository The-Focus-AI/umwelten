import { afterEach, describe, expect, it } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context as PiContext,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { McpSkillHost, memorySkillFiles, SkillsExtension, type SkillCatalog } from "@umwelten/protocols";
import { createTestMcpServer, type TestMcpServer } from "@umwelten/protocols/mcp/testing.js";
import {
  answerMcpSkillApproval,
  createMcpSkillsExtension,
  DurableHabitat,
  getActiveMcpSkills,
  type PendingMcpSkillApproval,
} from "./index.js";

const ctx = BACKGROUND_CONTEXT;

const files: Record<string, string> = {
  "deploy/SKILL.md":
    "---\nname: deploy\ndescription: Ship the service to staging\nallowed-tools: Bash(*)\n---\nRun ./deploy.sh then read references/CHECKLIST.md.\n",
  "deploy/references/CHECKLIST.md": "1. test\n2. tag\n",
};

async function waitFor<T>(probe: () => T | undefined, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup() {
  const catalog = await SkillsExtension.load(memorySkillFiles(files));
  const server: TestMcpServer = createTestMcpServer({ name: "docs", skills: catalog });
  cleanups.push(() => server.close());
  const host = new McpSkillHost();
  await host.addServer(await server.connect("docs"));

  const pending = new Map<string, PendingMcpSkillApproval>();
  const bashRuns: string[] = [];
  const fakeBash = defineExtension({
    name: "test.bash",
    tools: [
      defineTool({
        name: "bash",
        description: "Run a shell command",
        parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } as const,
        async execute(args) {
          bashRuns.push((args as { command: string }).command);
          return { output: [{ type: "text", text: "ok" }] };
        },
      }),
    ],
  });

  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const habitat = await DurableHabitat.open({
    id: "skills-test",
    models,
    model: { provider: "faux", modelId: "faux-1" },
    extensions: [
      createMcpSkillsExtension({
        host,
        onApprovalRequested: (p) => pending.set(p.key, p),
        onApprovalSettled: (key) => pending.delete(key),
      }),
      fakeBash,
    ],
  });
  cleanups.push(() => habitat.close());
  return { catalog: catalog as SkillCatalog, host, habitat, faux, pending, bashRuns };
}

describe("MCP Skills in a pi-durable Harness", () => {
  it("lists lazily, parks skill_load on approval, tags origin, gates code execution, and forks active skills", async () => {
    const { host, habitat, faux, pending, bashRuns } = await setup();
    let firstPrompt = "";
    let loadResult = "";
    faux.setResponses([
      (context: PiContext) => {
        firstPrompt = JSON.stringify(context);
        return fauxAssistantMessage([fauxToolCall("skill_load", { skill: "docs/deploy" }, { id: "l1" })], {
          stopReason: "toolUse",
        });
      },
      (context: PiContext) => {
        const last = context.messages.at(-1);
        loadResult = JSON.stringify(last);
        return fauxAssistantMessage([fauxToolCall("bash", { command: "./deploy.sh" }, { id: "b1" })], {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("Deployed."),
    ]);

    const conv = await habitat.root(ctx);
    const sub = await conv.submit({ type: "input", content: "Deploy please", whenBusy: "followUp" }, ctx);

    const loadAsk = await waitFor(() => [...pending.values()].find((p) => p.kind === "skill-load"));
    expect(firstPrompt).toContain("docs/deploy — Ship the service to staging (origin: MCP server \\\"docs\\\"");
    expect(firstPrompt).not.toContain("Run ./deploy.sh");
    expect(loadAsk.skill).toMatchObject({
      qualifiedName: "docs/deploy",
      manifestHash: host.resolve("docs/deploy").manifestHash,
      ignoredFields: ["allowed-tools"],
    });
    expect(await answerMcpSkillApproval(habitat.harness, loadAsk, true, ctx)).toBe("delivered");

    const execAsk = await waitFor(() => [...pending.values()].find((p) => p.kind === "code-execution"));
    expect(execAsk).toMatchObject({ toolName: "bash", activeSkills: ["mcp:docs/deploy"] });
    expect(bashRuns).toEqual([]);
    await answerMcpSkillApproval(habitat.harness, execAsk, true, ctx);

    await sub.wait(ctx);
    await conv.waitForIdle(ctx);
    expect(bashRuns).toEqual(["./deploy.sh"]);
    expect(loadResult).toContain('<mcp-skill origin=\\"mcp:docs\\" name=\\"deploy\\"');
    expect(loadResult).toContain("Run ./deploy.sh");
    expect(await host.isApproved(host.resolve("docs/deploy"))).toBe(true);

    const active = await getActiveMcpSkills(habitat.harness, conv.id, ctx);
    expect(active.map((a) => a.qualifiedName)).toEqual(["docs/deploy"]);
    const page = await conv.entries({ order: "descending" }, 1, undefined, ctx);
    const forked = await habitat.fork(page.items[0]!.id, { from: conv });
    expect((await getActiveMcpSkills(habitat.harness, forked.id, ctx)).map((a) => a.qualifiedName)).toEqual([
      "docs/deploy",
    ]);
  });

  it("asks again after the server's manifest changes, and blocks a declined load", async () => {
    const { catalog, host, habitat, faux, pending } = await setup();
    const rec = host.resolve("docs/deploy");
    await host.approve(rec, rec.manifestHash);

    files["deploy/references/CHECKLIST.md"] = "1. test\n2. tag\n3. announce\n";
    await catalog.reload();
    const result = await host.refresh("docs");
    expect(result.revoked).toEqual([rec.key]);

    let loadResult = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("skill_load", { skill: "docs/deploy" }, { id: "l2" })], { stopReason: "toolUse" }),
      (context: PiContext) => {
        loadResult = JSON.stringify(context.messages.at(-1));
        return fauxAssistantMessage("Okay, not loading it.");
      },
    ]);
    const conv = await habitat.root(ctx);
    const sub = await conv.submit({ type: "input", content: "Deploy", whenBusy: "followUp" }, ctx);
    const ask = await waitFor(() => [...pending.values()].find((p) => p.kind === "skill-load"));
    expect(ask.skill?.manifestHash).toBe(host.resolve("docs/deploy").manifestHash);
    expect(ask.skill?.manifestHash).not.toBe(rec.manifestHash);
    await answerMcpSkillApproval(habitat.harness, ask, false, ctx);
    await sub.wait(ctx);
    await conv.waitForIdle(ctx);
    expect(loadResult).toContain("declined");
    expect(await getActiveMcpSkills(habitat.harness, conv.id, ctx)).toEqual([]);
  });
});
