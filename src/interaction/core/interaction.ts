import { CoreMessage } from "ai";
import {
  ModelDetails,
  ModelOptions,
  ModelRunner,
  ModelResponse,
} from "../../cognition/types.js";
import { BaseModelRunner } from "../../cognition/runner.js";
import { createMemoryRunner } from "../../memory/memory_runner.js";
import { InMemoryMemoryStore } from "../../memory/memory_store.js";
// import { getAllTools } from "../../stimulus/tools/index.js";
import { z } from "zod";
import { buildAttachmentMessage } from "./attachments.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import { getCompactionSegment } from "../../context/segment.js";
import { getCompactionStrategy } from "../../context/registry.js";

import { v4 as uuidv4 } from "uuid";
import {
  NormalizedSession,
  SessionSource,
} from "../types/normalized-types.js";
import { buildHabitatIntrospectionContextMessages } from "../../session-record/context-merge.js";
import {
  interactionToNormalizedSession,
  normalizedSessionToMessages,
} from "./normalize.js";

export class Interaction {
  public id: string;
  public metadata: {
    created: Date;
    updated: Date;
    source?: SessionSource;
    sourceId?: string;
    sourceData?: Record<string, unknown>;
  };

  public messages: CoreMessage[] = [];
  protected runner: ModelRunner;
  public userId: string = "default";
  public modelDetails: ModelDetails;
  public stimulus: Stimulus; // NEW: Required stimulus
  public options?: ModelOptions;
  public outputFormat?: z.ZodSchema;
  public tools?: Record<string, any>;
  public maxSteps?: number;
  /** Message index after which the "current thread" starts (1 = first message after system). Used by compactContext. */
  private checkpointMessageIndex?: number;

  constructor(
    modelDetails: ModelDetails,
    stimulus: Stimulus, // NEW: Required parameter
    options?: {
      id?: string;
      created?: Date;
      updated?: Date;
      source?: SessionSource;
      sourceId?: string;
    },
  ) {
    this.modelDetails = modelDetails;
    this.stimulus = stimulus;

    this.id = options?.id || uuidv4();
    this.metadata = {
      created: options?.created || new Date(),
      updated: options?.updated || new Date(),
      source: options?.source || "native",
      sourceId: options?.sourceId || this.id,
    };

    // Apply stimulus context immediately
    this.applyStimulusContext();

    // Create the appropriate runner
    this.runner = this.createRunner(this.stimulus.getRunnerType());
  }

  private applyStimulusContext(): void {
    // Set system prompt from stimulus
    this.messages.push({
      role: "system",
      content: this.stimulus.getPrompt(),
    });

    // Apply model options from stimulus
    if (this.stimulus.hasModelOptions()) {
      this.options = this.stimulus.getModelOptions();
    }

    // Apply tools from stimulus
    if (this.stimulus.hasTools()) {
      this.tools = this.stimulus.getTools();
    }

    // Apply tool-specific settings
    if (this.stimulus.options?.maxToolSteps) {
      this.setMaxSteps(this.stimulus.options.maxToolSteps);
    }
  }

  // NEW: Method to update stimulus (for dynamic changes)
  setStimulus(stimulus: Stimulus): void {
    this.stimulus = stimulus;

    // Update system prompt
    if (this.messages[0]?.role === "system") {
      this.messages[0].content = stimulus.getPrompt();
    }

    // Update tools from new stimulus
    if (stimulus.hasTools()) {
      this.tools = stimulus.getTools();
    }

    // Update model options from new stimulus
    if (stimulus.hasModelOptions()) {
      this.options = stimulus.getModelOptions();
    }

    this.metadata.updated = new Date();
  }

  // NEW: Get current stimulus
  getStimulus(): Stimulus {
    return this.stimulus;
  }

  setSystemPrompt(prompt: string): void {
    console.warn(
      "setSystemPrompt is deprecated. Use setStimulus with a new Stimulus object instead.",
    );

    if (this.messages[0].role === "system") {
      this.messages[0].content = prompt;
    } else {
      console.warn(
        "System prompt not found, adding to the beginning of the messages",
      );
      this.messages.unshift({
        role: "system",
        content: prompt,
      });
    }
    this.metadata.updated = new Date();
  }

  protected createRunner(runnerType: "base" | "memory"): ModelRunner {
    switch (runnerType) {
      case "memory":
        return createMemoryRunner({
          baseRunner: new BaseModelRunner(),
          llmModel: this.modelDetails.name,
          memoryStore: new InMemoryMemoryStore(),
          factExtractionModel: this.modelDetails,
        });
      default:
        return new BaseModelRunner();
    }
  }

  /** Optional callback invoked whenever messages change (e.g. so CLI can append transcript). */
  onTranscriptUpdate?: (messages: CoreMessage[]) => void;

  setOnTranscriptUpdate(callback: (messages: CoreMessage[]) => void): void {
    this.onTranscriptUpdate = callback;
  }

  addMessage(message: CoreMessage): void {
    this.messages.push(message);
    this.metadata.updated = new Date();
  }

  /**
   * After Habitat transcript compaction or when reloading from disk, prepend compaction summaries
   * and serialized learnings as extra system messages (after the stimulus system prompt).
   */
  async prependHabitatIntrospectionFromDisk(options: {
    sessionDir: string;
    learningsRoot?: string;
  }): Promise<void> {
    const extra = await buildHabitatIntrospectionContextMessages({
      sessionDir: options.sessionDir,
      learningsRoot: options.learningsRoot,
    });
    if (extra.length === 0) return;
    if (this.messages[0]?.role === "system") {
      this.messages.splice(1, 0, ...extra);
    } else {
      this.messages.unshift(...extra);
    }
    this.metadata.updated = new Date();
  }

  /** Call after adding message(s) so transcript can be written incrementally. */
  notifyTranscriptUpdate(): void {
    if (this.onTranscriptUpdate) {
      this.onTranscriptUpdate(this.getMessages());
    }
  }

  async addAttachmentFromPath(
    attachment: string,
    mime_type?: string,
  ): Promise<void> {
    const msg = await buildAttachmentMessage(attachment, mime_type);
    this.addMessage(msg);
  }

  setOutputFormat(outputFormat: z.ZodSchema): void {
    this.outputFormat = outputFormat;
  }

  /**
   * Set tools for this interaction
   */
  setTools(tools: Record<string, any>): void {
    this.tools = tools;
  }

  /**
   * Add a single tool to this interaction
   */
  addTool(name: string, tool: any): void {
    if (!this.tools) this.tools = {};
    this.tools[name] = tool;
  }

  /**
   * Set maximum number of steps for multi-step tool calling
   */
  setMaxSteps(maxSteps: number): void {
    this.maxSteps = maxSteps;
  }

  /**
   * Get tools in Vercel AI SDK format
   */
  getVercelTools() {
    return this.tools || undefined;
  }

  /**
   * Check if this interaction has tools
   */
  hasTools(): boolean {
    return this.tools !== undefined && Object.keys(this.tools).length > 0;
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  clearContext(): void {
    this.messages = [];
    this.checkpointMessageIndex = undefined;
    this.metadata.updated = new Date();
  }

  /**
   * Set checkpoint to current message count (everything after this index is the current thread).
   */
  setCheckpoint(): void {
    this.checkpointMessageIndex = this.messages.length;
  }

  /**
   * Get current checkpoint index, or undefined if not set.
   */
  getCheckpoint(): number | undefined {
    return this.checkpointMessageIndex;
  }

  /**
   * Compact context by replacing the segment (from checkpoint or start through end of last flow)
   * with the output of the given strategy. Updates checkpoint to after the replacement.
   * @returns Segment bounds and replacement count, or null if no segment or unknown strategy.
   */
  async compactContext(
    strategyId: string,
    options?: {
      fromCheckpoint?: boolean;
      strategyOptions?: Record<string, unknown>;
    },
  ): Promise<{
    segmentStart: number;
    segmentEnd: number;
    replacementCount: number;
  } | null> {
    const fromCheckpoint = options?.fromCheckpoint ?? true;
    const segment = getCompactionSegment(this.messages, {
      fromCheckpoint,
      checkpointIndex: this.getCheckpoint(),
    });
    if (!segment) return null;

    const strategy = await getCompactionStrategy(strategyId);
    if (!strategy) return null;

    const result = await strategy.compact({
      messages: this.messages,
      segmentStart: segment.start,
      segmentEnd: segment.end,
      model: this.modelDetails,
      runner: this.getRunner(),
      options: options?.strategyOptions,
    });

    const before = this.messages.slice(0, segment.start);
    const after = this.messages.slice(segment.end + 1);
    this.messages = before.concat(result.replacementMessages).concat(after);
    this.checkpointMessageIndex =
      segment.start + result.replacementMessages.length;
    this.metadata.updated = new Date();

    return {
      segmentStart: segment.start,
      segmentEnd: segment.end,
      replacementCount: result.replacementMessages.length,
    };
  }

  // Delegate to the internal runner
  async generateText(): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.generateText(this);
  }

  async streamText(signal?: AbortSignal): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.streamText(this, signal);
  }

  async generateObject(schema: z.ZodSchema): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.generateObject(this, schema);
  }

  async streamObject(schema: z.ZodSchema): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.streamObject(this, schema);
  }

  // Access to underlying components when needed
  getRunner(): ModelRunner {
    return this.runner;
  }

  /**
   * Convert to normalized session format for storage/display
   */
  toNormalizedSession(): NormalizedSession {
    return interactionToNormalizedSession(this.id, this.messages, this.metadata);
  }

  /**
   * Recreate an Interaction from a normalized session
   */
  static fromNormalizedSession(
    session: NormalizedSession,
    modelDetails: ModelDetails,
    stimulus?: Stimulus,
  ): Interaction {
    const data = normalizedSessionToMessages(session);

    if (!stimulus) {
      stimulus = new Stimulus({
        role: "assistant",
        systemContext: data.systemContent,
      });
    }

    const interaction = new Interaction(modelDetails, stimulus, {
      id: data.id,
      created: data.created,
      updated: data.updated,
      source: data.source,
      sourceId: data.sourceId,
    });

    interaction.messages = data.messages;
    return interaction;
  }
}
