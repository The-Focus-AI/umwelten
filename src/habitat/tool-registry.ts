/**
 * ToolRegistry: manages tool registration for a Habitat.
 * Extracted from Habitat to keep tool management concerns separate.
 */

import type { Tool } from "ai";
import type { ToolSet } from "./tool-sets.js";
import type { Stimulus } from "../stimulus/stimulus.js";
import type { SkillDefinition } from "../stimulus/skills/types.js";
import type { Habitat } from "./habitat.js";

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
    this.registeredTools[name] = tool;
    if (this.stimulus) {
      this.stimulus.addTool(name, tool);
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
