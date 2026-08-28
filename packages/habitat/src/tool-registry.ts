/**
 * ToolRegistry: manages tool registration for a Habitat.
 * Extracted from Habitat to keep tool management concerns separate.
 */

import type { Tool } from "ai";
import type { ToolSet } from "./tool-sets.js";
import type { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import type { SkillDefinition } from "@umwelten/core/stimulus/skills/types.js";
import { createContext, mount, type Fiber } from "@umwelten/substrate";
import type { Habitat } from "./habitat.js";

export class ToolRegistry {
  private registeredTools: Record<string, Tool> = {};
  private workDirLayers: Array<{
    token: symbol;
    tools: Record<string, Tool>;
  }> = [];
  private readonly substrate = createContext();
  private workDirFiber: Fiber | null = null;
  private stimulus: Stimulus | null = null;
  private habitat: Habitat;

  constructor(habitat: Habitat) {
    this.habitat = habitat;
  }

  setStimulus(stimulus: Stimulus | null): void {
    this.stimulus = stimulus;
    this.syncStimulus();
  }

  addTool(name: string, tool: Tool): void {
    this.registeredTools[name] = tool;
    this.syncStimulus();
  }

  addTools(tools: Record<string, Tool>): void {
    for (const [name, tool] of Object.entries(tools)) {
      this.addTool(name, tool);
    }
  }

  getTools(): Record<string, Tool> {
    return Object.assign(
      {},
      this.registeredTools,
      ...this.workDirLayers.map((layer) => layer.tools),
    );
  }

  /**
   * Replace the project/work-directory tool layer as one reversible substrate
   * component. Callers load every handler before this boundary; mounting the
   * next layer therefore succeeds before the previous layer is unmounted.
   * Its inverse withdraws tools that disappeared and reveals any built-in a
   * custom tool had shadowed.
   */
  async replaceWorkDirTools(tools: Record<string, Tool>): Promise<void> {
    const token = Symbol("work-directory-tools");
    const next = mount<void>(this.substrate, {
      name: "work-directory-tools",
      apply: (ctx) => {
        ctx.effect(() => {
          this.workDirLayers.push({ token, tools: { ...tools } });
          this.syncStimulus();
          return () => {
            this.workDirLayers = this.workDirLayers.filter(
              (layer) => layer.token !== token,
            );
            this.syncStimulus();
          };
        });
      },
    });
    await next.settled();

    const previous = this.workDirFiber;
    this.workDirFiber = next;
    if (previous) await previous.unmount();
  }

  addToolSet(toolSet: ToolSet): void {
    const tools = toolSet.createTools(this.habitat);
    this.addTools(tools);
  }

  getSkills(): SkillDefinition[] {
    const registry = this.stimulus?.getSkillsRegistry();
    return registry ? registry.listSkills() : [];
  }

  private syncStimulus(): void {
    this.stimulus?.setTools(this.getTools());
  }
}
