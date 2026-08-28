import { describe, expect, it } from "vitest";
import type { Tool } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { ToolRegistry } from "./tool-registry.js";
import type { Habitat } from "./habitat.js";

function namedTool(value: string): Tool {
  return {
    description: value,
    inputSchema: { type: "object", properties: {} },
    execute: async () => value,
  } as Tool;
}

describe("ToolRegistry work-directory component", () => {
  it("reverses the previous layer and synchronizes the active Stimulus", async () => {
    const registry = new ToolRegistry({} as Habitat);
    const stimulus = new Stimulus();
    const builtin = namedTool("builtin");
    const override = namedTool("override");
    const database = namedTool("database");

    registry.addTool("lookup", builtin);
    registry.setStimulus(stimulus);
    await registry.replaceWorkDirTools({ lookup: override, database });

    expect(registry.getTools()).toEqual({ lookup: override, database });
    expect(stimulus.getTools()).toEqual({ lookup: override, database });

    await registry.replaceWorkDirTools({});

    expect(registry.getTools()).toEqual({ lookup: builtin });
    expect(stimulus.getTools()).toEqual({ lookup: builtin });
  });

  it("withdraws tools omitted by a replacement", async () => {
    const registry = new ToolRegistry({} as Habitat);
    const first = namedTool("first");
    const second = namedTool("second");

    await registry.replaceWorkDirTools({ first });
    await registry.replaceWorkDirTools({ second });

    expect(registry.getTools()).toEqual({ second });
  });
});
