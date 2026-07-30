/**
 * ToolRegistry: manages tool registration for a Habitat.
 * Extracted from Habitat to keep tool management concerns separate.
 */

import type { Tool } from "ai";
import type { ToolSet } from "./tool-sets.js";
import type { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import type { SkillDefinition } from "@umwelten/core/stimulus/skills/types.js";
import type { Habitat } from "./habitat.js";
import { guardTool } from "./identity/caller-scope.js";

export class ToolRegistry {
  private registeredTools: Record<string, Tool> = {};
  private stimulus: Stimulus | null = null;
  private habitat: Habitat;

  constructor(habitat: Habitat) {
    this.habitat = habitat;
  }

  setStimulus(stimulus: Stimulus | null): void {
    this.stimulus = stimulus;
  }

  addTool(name: string, tool: Tool): void {
    // Guard at registration, check at call time: the assembled Stimulus is
    // cached per channel and outlives the request that built it, so the scope
    // has to be read when the tool runs. No-op for every existing caller —
    // unscoped requests and the operator bearer are unaffected.
    const guarded = guardTool(name, tool);
    this.registeredTools[name] = guarded;
    if (this.stimulus) {
      this.stimulus.addTool(name, guarded);
    }
  }

  addTools(tools: Record<string, Tool>): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.addTool(name, tool);
    }
  }

  getTools(): Record<string, Tool> {
    return { ...this.registeredTools };
  }

  addToolSet(toolSet: ToolSet): void {
    const tools = toolSet.createTools(this.habitat);
    this.addTools(tools);
  }

  getSkills(): SkillDefinition[] {
    const registry = this.stimulus?.getSkillsRegistry();
    return registry ? registry.listSkills() : [];
  }
}
