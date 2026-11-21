import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import umweltenPiExtension from "./index.js";

describe("@umwelten/pi extension", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "umwelten-pi-ext-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers session sensemaking tools and commands without inventing custom providers", async () => {
    const registeredProviders: unknown[] = [];
    const registeredTools = new Map<string, any>();
    const registeredCommands = new Map<string, any>();

    const mockPi: any = {
      registerProvider: (p: unknown) => registeredProviders.push(p),
      registerTool: (t: any) => registeredTools.set(t.name, t),
      registerCommand: (name: string, cmd: any) =>
        registeredCommands.set(name, cmd),
    };

    umweltenPiExtension(mockPi);

    expect(registeredProviders).toHaveLength(0);
    expect(registeredTools.has("umwelten_session_search")).toBe(true);
    expect(registeredTools.has("umwelten_promote_knowledge")).toBe(true);
    expect(registeredCommands.has("umwelten-explorations")).toBe(true);

    const promoteTool = registeredTools.get("umwelten_promote_knowledge");
    const result = await promoteTool.execute(
      "call-1",
      {
        target: "project-fact",
        title: "Money representation",
        content: "Mycel stores all currency balances in integer micro-dollars.",
      },
      undefined,
      undefined,
      { cwd: tempDir },
    );

    expect(result.details.target).toBe("project-fact");
    const factsMd = await readFile(join(tempDir, "FACTS.md"), "utf8");
    expect(factsMd).toContain("integer micro-dollars");
  });
});
