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
  ): Promise<{ok: boolean, interaction: Interaction}> {
    let ctx = interaction;
    for (const hook of hooks) {
      const result = await hook(ctx);
      if (result instanceof RunnerAbort) return { ok: false, interaction: ctx };
      if (result instanceof RunnerModification) {
        ctx = result.modify(ctx);
      }
    }
    return { ok: true, interaction: ctx };
  }

  async generateText(interaction: Interaction): Promise<ModelResponse> {
    // Before hooks
    const beforeResult = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeResult.ok) throw new Error("Aborted by before hook");
    let ctx = beforeResult.interaction;

    // Main model run
    const mainResult = await super.generateText(ctx);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(ctx)));

    // After hooks
    const afterResult = await this.runHooks(this.afterHooks, ctx);
    if (!afterResult.ok) throw new Error("Aborted by after hook");

    return mainResult;
  }

  async streamText(interaction: Interaction): Promise<ModelResponse> {
    // Before hooks
    const beforeResult = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeResult.ok) throw new Error("Aborted by before hook");
    let ctx = beforeResult.interaction;

    // Main model run
    const mainResult = await super.streamText(ctx);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(ctx)));

    // After hooks
    const afterResult = await this.runHooks(this.afterHooks, ctx);
    if (!afterResult.ok) throw new Error("Aborted by after hook");

    return mainResult;
  }
}