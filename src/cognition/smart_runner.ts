import { Interaction } from "../interaction/interaction.js";
import { ModelResponse, ModelRunner } from "./types.js";

/**
 * Types for runner hooks
 */

export type RunnerHook = (interaction: Interaction) => Promise<void | RunnerAbort | RunnerModification>;

export class RunnerAbort {
  constructor(public reason: string) {}
}

export class RunnerModification {
  // Deprecated: context modification is not supported in this version.
  constructor(public modify: (interaction: Interaction) => Interaction) {}
}

/**
 * SmartModelRunner supports before, during, and after hooks.
 */
export interface SmartModelRunnerConfig {
  beforeHooks?: RunnerHook[];
  duringHooks?: RunnerHook[];
  afterHooks?: RunnerHook[];
  baseRunner: ModelRunner;
}

import { BaseModelRunner } from "./runner.js";

export class SmartModelRunner extends BaseModelRunner {
  private beforeHooks: RunnerHook[];
  private duringHooks: RunnerHook[];
  private afterHooks: RunnerHook[];
  constructor(config: SmartModelRunnerConfig) {
    super(config.baseRunner ? (config.baseRunner as any).config : {});
    this.beforeHooks = config.beforeHooks || [];
    this.duringHooks = config.duringHooks || [];
    this.afterHooks = config.afterHooks || [];
  }

  private async runHooks(
    hooks: RunnerHook[],
    interaction: Interaction
  ): Promise<boolean> {
    for (const hook of hooks) {
      const result = await hook(interaction);
      if (result instanceof RunnerAbort) return false;
      if (result instanceof RunnerModification) {
        // If you want to support modifications, you can extend Interaction or handle here
      }
    }
    return true;
  }

  async generateText(interaction: Interaction): Promise<ModelResponse> {
    // Before hooks
    const beforeOk = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeOk) throw new Error("Aborted by before hook");

    // Main model run
    const mainResult = await super.generateText(interaction);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(interaction)));

    // After hooks
    const afterOk = await this.runHooks(this.afterHooks, interaction);
    if (!afterOk) throw new Error("Aborted by after hook");

    return mainResult;
  }

  async streamText(interaction: Interaction): Promise<ModelResponse> {
    // Before hooks
    const beforeOk = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeOk) throw new Error("Aborted by before hook");

    // Main model run
    const mainResult = await super.streamText(interaction);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(interaction)));

    // After hooks
    const afterOk = await this.runHooks(this.afterHooks, interaction);
    if (!afterOk) throw new Error("Aborted by after hook");

    return mainResult;
  }
}