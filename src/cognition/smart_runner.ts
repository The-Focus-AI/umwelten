import { Interaction } from "../interaction/core/interaction.js";
import { ModelResponse, ModelRunner } from "./types.js";
import { z } from "zod";

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

export class SmartModelRunner implements ModelRunner {
  private beforeHooks: RunnerHook[];
  private duringHooks: RunnerHook[];
  private afterHooks: RunnerHook[];
  private baseRunner: ModelRunner;

  constructor(config: SmartModelRunnerConfig) {
    this.baseRunner = config.baseRunner;
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
    const mainResult = await this.baseRunner.generateText(ctx);

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
    const mainResult = await this.baseRunner.streamText(ctx);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(ctx)));

    // After hooks
    const afterResult = await this.runHooks(this.afterHooks, ctx);
    if (!afterResult.ok) throw new Error("Aborted by after hook");

    return mainResult;
  }

  async generateObject(interaction: Interaction, schema: z.ZodSchema): Promise<ModelResponse> {
    // Before hooks
    const beforeResult = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeResult.ok) throw new Error("Aborted by before hook");
    let ctx = beforeResult.interaction;

    // Main model run
    const mainResult = await this.baseRunner.generateObject(ctx, schema);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(ctx)));

    // After hooks
    const afterResult = await this.runHooks(this.afterHooks, ctx);
    if (!afterResult.ok) throw new Error("Aborted by after hook");

    return mainResult;
  }

  async streamObject(interaction: Interaction, schema: z.ZodSchema): Promise<ModelResponse> {
    // Before hooks
    const beforeResult = await this.runHooks(this.beforeHooks, interaction);
    if (!beforeResult.ok) throw new Error("Aborted by before hook");
    let ctx = beforeResult.interaction;

    // Main model run
    const mainResult = await this.baseRunner.streamObject(ctx, schema);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(ctx)));

    // After hooks
    const afterResult = await this.runHooks(this.afterHooks, ctx);
    if (!afterResult.ok) throw new Error("Aborted by after hook");

    return mainResult;
  }
}