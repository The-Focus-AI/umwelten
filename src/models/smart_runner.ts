import { Conversation } from "../conversation/conversation.js";
import { ModelResponse, ModelRunner } from "./types.js";

/**
 * Types for runner hooks
 */

export type RunnerHook = (conversation: Conversation) => Promise<void | RunnerAbort | RunnerModification>;

export class RunnerAbort {
  constructor(public reason: string) {}
}

export class RunnerModification {
  // Deprecated: context modification is not supported in this version.
  constructor(public modify: (conversation: Conversation) => Conversation) {}
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
    conversation: Conversation
  ): Promise<boolean> {
    for (const hook of hooks) {
      const result = await hook(conversation);
      if (result instanceof RunnerAbort) return false;
      if (result instanceof RunnerModification) {
        // If you want to support modifications, you can extend Conversation or handle here
      }
    }
    return true;
  }

  async generateText(conversation: Conversation): Promise<ModelResponse> {
    // Before hooks
    const beforeOk = await this.runHooks(this.beforeHooks, conversation);
    if (!beforeOk) throw new Error("Aborted by before hook");

    // Main model run
    const mainResult = await super.generateText(conversation);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(conversation)));

    // After hooks
    const afterOk = await this.runHooks(this.afterHooks, conversation);
    if (!afterOk) throw new Error("Aborted by after hook");

    return mainResult;
  }

  async streamText(conversation: Conversation): Promise<ModelResponse> {
    // Before hooks
    const beforeOk = await this.runHooks(this.beforeHooks, conversation);
    if (!beforeOk) throw new Error("Aborted by before hook");

    // Main model run
    const mainResult = await super.streamText(conversation);

    // During hooks (parallel/side tasks)
    await Promise.all(this.duringHooks.map(hook => hook(conversation)));

    // After hooks
    const afterOk = await this.runHooks(this.afterHooks, conversation);
    if (!afterOk) throw new Error("Aborted by after hook");

    return mainResult;
  }
}