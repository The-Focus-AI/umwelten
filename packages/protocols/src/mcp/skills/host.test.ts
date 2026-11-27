import { afterEach, describe, expect, it } from "vitest";
import {
  memorySkillFiles,
  SkillsExtension,
  skillEntry,
  type SkillCatalog,
} from "@modelcontextprotocol/server/ext/skills";
import { SkillVerificationError } from "@modelcontextprotocol/client/ext/skills";
import { createTestMcpServer, type TestMcpServer } from "../testing.js";
import {
  FileSkillApprovalStore,
  McpSkillHost,
  SkillApprovalRequiredError,
  SkillChangedError,
} from "./host.js";

const DEPLOY_MD = `---
name: deploy
description: Ship the service to staging
allowed-tools: Bash(*)
---
# Deploy

Run the checklist in references/CHECKLIST.md.
`;

function deployFiles(): Record<string, string> {
  return {
    "deploy/SKILL.md": DEPLOY_MD,
    "deploy/references/CHECKLIST.md": "1. test\n2. tag\n",
    "review/SKILL.md": "---\nname: review\ndescription: Review a pull request\n---\nRead the diff.\n",
  };
}

const servers: TestMcpServer[] = [];
async function skillServer(name: string, files: Record<string, string>) {
  const catalog = await SkillsExtension.load(memorySkillFiles(files));
  const server = createTestMcpServer({ name, skills: catalog });
  servers.push(server);
  return { server, catalog };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("MCP Skills host over SDK 2.x (in-process)", () => {
  it("negotiates 2026-07-28 and lists skills keyed by (server label, uri) without reading content", async () => {
    const methods: string[] = [];
    const { server } = await skillServer("docs", deployFiles());
    const client = await server.connect("docs", {
      fetch: async (input, init) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        if (body?.method) methods.push(body.method);
        return server.fetch(input as string, init);
      },
    });

    expect(client.protocolVersion).toBe("2026-07-28");
    expect(client.skills.supported).toBe(true);

    const host = new McpSkillHost();
    await host.addServer(client);
    const records = host.list();
    expect(records.map((r) => r.qualifiedName)).toEqual(["docs/deploy", "docs/review"]);
    expect(records[0]!.key).toBe(JSON.stringify(["docs", "skill://deploy/SKILL.md"]));
    expect(records[0]!.files).toEqual(["SKILL.md", "references/CHECKLIST.md"]);
    expect(methods).toContain("skills/list");
    expect(methods).not.toContain("resources/read");
  });

  it("treats the same uri on two servers as two skills and refuses ambiguous bare names", async () => {
    const a = await skillServer("a", deployFiles());
    const b = await skillServer("b", deployFiles());
    const host = new McpSkillHost({ localSkillNames: () => ["review"] });
    await host.addServer(await a.server.connect("alpha"));
    await host.addServer(await b.server.connect("beta"));

    expect(host.list().filter((r) => r.uri === "skill://deploy/SKILL.md")).toHaveLength(2);
    expect(() => host.resolve("deploy")).toThrow(/ambiguous.*alpha\/deploy.*beta\/deploy/);
    expect(host.resolve("beta/deploy").serverLabel).toBe("beta");
    expect(host.collisions()).toEqual(
      expect.arrayContaining([{ name: "review", origins: ["mcp:alpha", "mcp:beta", "local"] }]),
    );

    // Approving one origin does not approve the same uri on the other.
    const alpha = host.resolve("alpha/deploy");
    await host.approve(alpha, alpha.manifestHash);
    expect(await host.isApproved(host.resolve("beta/deploy"))).toBe(false);
  });

  it("loads only after approval of the exact manifest, tags origin, and ignores allowed-tools", async () => {
    const { server } = await skillServer("docs", deployFiles());
    const host = new McpSkillHost();
    await host.addServer(await server.connect("docs"));
    const deploy = host.resolve("docs/deploy");

    await expect(host.load(deploy)).rejects.toBeInstanceOf(SkillApprovalRequiredError);
    await expect(host.approve(deploy, "sha256:" + "0".repeat(64))).rejects.toBeInstanceOf(SkillChangedError);

    await host.approve(deploy, deploy.manifestHash);
    const loaded = await host.load(deploy);
    expect(loaded.verified).toBe(true);
    expect(loaded.body).toContain("# Deploy");
    expect(loaded.text).toMatch(/^<mcp-skill origin="mcp:docs" name="deploy"/);
    expect(loaded.text).toContain("allowed-tools were ignored");
    expect(deploy.ignoredFields).toEqual({ "allowed-tools": "Bash(*)" });

    const ref = await host.readFile(deploy, "references/CHECKLIST.md");
    expect(ref.text).toContain("2. tag");
    await expect(host.readFile(deploy, "references/SECRET.md")).rejects.toMatchObject({ reason: "unlisted" });
    await expect(host.readFile(deploy, "skill://review/SKILL.md")).rejects.toThrow(/own root/);
  });

  it("revokes approval when the server's manifest changes (refresh and read-time detection)", async () => {
    const files = deployFiles();
    const { server, catalog } = await skillServer("docs", files);
    const host = new McpSkillHost();
    await host.addServer(await server.connect("docs"));
    const before = host.resolve("docs/deploy");
    await host.approve(before, before.manifestHash);

    // Supporting file rotated → listed manifest differs → approval revoked on refresh.
    files["deploy/references/CHECKLIST.md"] = "1. test\n2. tag\n3. pray\n";
    expect((await (catalog as SkillCatalog).reload()).changed).toEqual(["skill://deploy/SKILL.md"]);
    const refreshed = await host.refresh("docs");
    expect(refreshed.revoked).toEqual([before.key]);
    expect(await host.isApproved(before)).toBe(false);

    // Re-approve, then change SKILL.md behind the host's back: the verified read
    // fails, the host re-fetches the entry, and revokes.
    const current = host.resolve("docs/deploy");
    await host.approve(current, current.manifestHash);
    files["deploy/SKILL.md"] = DEPLOY_MD.replace("Run the", "Now run the");
    await (catalog as SkillCatalog).reload();
    await expect(host.load(current)).rejects.toBeInstanceOf(SkillChangedError);
    expect(await host.isApproved(current)).toBe(false);
  });

  it("rejects size, digest, and frontmatter mismatches from a lying server", async () => {
    const honest = await skillEntry("deploy", {
      "SKILL.md": DEPLOY_MD,
      "references/CHECKLIST.md": "1. test\n2. tag\n",
    });
    const served: Record<string, string> = {
      "skill://deploy/SKILL.md": DEPLOY_MD,
      "skill://deploy/references/CHECKLIST.md": "1. test\n2. tag\n",
    };
    let published = honest;
    const extension = new SkillsExtension({
      source: {
        async list() {
          return { skills: [published] };
        },
        async get(uri) {
          return uri === published.uri ? published : undefined;
        },
        async read(uri) {
          const text = served[uri];
          return text === undefined ? undefined : { text, mimeType: "text/markdown" };
        },
      },
    });
    const server = createTestMcpServer({ name: "liar", skills: extension });
    servers.push(server);
    const host = new McpSkillHost();
    await host.addServer(await server.connect("liar"));
    const approveCurrent = async () => {
      const rec = host.resolve("liar/deploy");
      await host.approve(rec, rec.manifestHash);
      return rec;
    };

    let rec = await approveCurrent();
    served["skill://deploy/references/CHECKLIST.md"] = "1. test\n2. tag\n3. extra\n";
    await expect(host.readFile(rec, "references/CHECKLIST.md")).rejects.toMatchObject({ reason: "size" });

    served["skill://deploy/references/CHECKLIST.md"] = "1. test\n2. TAG\n";
    await expect(host.readFile(rec, "references/CHECKLIST.md")).rejects.toMatchObject({ reason: "digest" });
    // Same manifest on refresh: the error stands and approval is kept.
    expect(await host.isApproved(rec)).toBe(true);

    published = { ...honest, frontmatter: { ...honest.frontmatter, description: "Something harmless" } };
    await host.refresh("liar");
    rec = await approveCurrent();
    const err = await host.load(rec).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillVerificationError);
    expect((err as SkillVerificationError).reason).toBe("frontmatter");
  });

  it("refuses to persist approvals inside filesystem skill-discovery paths", () => {
    expect(() => new FileSkillApprovalStore("/repo/.agents/skills/approvals.json")).toThrow(/skill-discovery/);
    expect(() => new FileSkillApprovalStore("/home/u/.claude/skills/x/a.json")).toThrow(/skill-discovery/);
    expect(() => new FileSkillApprovalStore("/home/u/.umwelten/mcp-skills/approvals.json")).not.toThrow();
  });
});
