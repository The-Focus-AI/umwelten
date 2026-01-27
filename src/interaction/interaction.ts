import { CoreMessage } from "ai";
import { ModelDetails, ModelOptions, ModelRunner, ModelResponse } from "../cognition/types.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { createMemoryRunner } from "../memory/memory_runner.js";
import { InMemoryMemoryStore } from "../memory/memory_store.js";
// import { getAllTools } from "../stimulus/tools/index.js";
import path from "path";
import fs, { FileHandle } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { PathLike } from "fs";
import { z } from "zod";
import { Stimulus } from "../stimulus/stimulus.js";
import { getCompactionSegment } from "../context/segment.js";
import { getCompactionStrategy } from "../context/registry.js";

export class Interaction {
  public messages: CoreMessage[] = [];
  protected runner: ModelRunner;
  public userId: string = "default";
  public modelDetails: ModelDetails;
  public stimulus: Stimulus;  // NEW: Required stimulus
  public options?: ModelOptions;
  public outputFormat?: z.ZodSchema;
  public tools?: Record<string, any>;
  public maxSteps?: number;
  /** Message index after which the "current thread" starts (1 = first message after system). Used by compactContext. */
  private checkpointMessageIndex?: number;

  constructor(
    modelDetails: ModelDetails,
    stimulus: Stimulus  // NEW: Required parameter
  ) {
    this.modelDetails = modelDetails;
    this.stimulus = stimulus;
    
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
    if(this.messages[0]?.role === "system") {
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
  }

  // NEW: Get current stimulus
  getStimulus(): Stimulus {
    return this.stimulus;
  }

  
  setSystemPrompt(prompt: string): void {
    console.warn("setSystemPrompt is deprecated. Use setStimulus with a new Stimulus object instead.");
    
    if(this.messages[0].role === "system") {
      this.messages[0].content = prompt;
    } else {
      console.warn("System prompt not found, adding to the beginning of the messages");
      this.messages.unshift({
        role: "system",
        content: prompt,
      });
    }
  }

  protected createRunner(runnerType: 'base' | 'memory'): ModelRunner {
    switch (runnerType) {
      case 'memory':
        return createMemoryRunner({
          baseRunner: new BaseModelRunner(),
          llmModel: this.modelDetails.name,
          memoryStore: new InMemoryMemoryStore()
        });
      default:
        return new BaseModelRunner();
    }
  }

  addMessage(message: CoreMessage): void {
    this.messages.push(message);
  }

  async addAttachmentFromPath(
    attachment: string,
    mime_type?: string
  ): Promise<void> {
    let data = attachment;

    const filename = path.basename(attachment);
    console.log("Creating attachment for", filename);
    const fileBuffer = await fs.readFile(attachment);
    if (!mime_type) {
      const fileType = await fileTypeFromBuffer(fileBuffer);
      mime_type = fileType?.mime;
    }

    // convert to base64
    data = fileBuffer.toString("base64");

    if (mime_type && mime_type.startsWith("image/")) {
      this.addMessage({
        role: "user",
        content: [
          { type: "text", text: `I've shared an image named ${filename} for you to analyze.` },
          { type: "image", image: data as string },
        ],
      });
    } else {
      this.addMessage({
        role: "user",
        content: [
          { type: "text", text: `I've shared a file named ${filename} for you to analyze.` },
          {
            type: "file",
            data: data as string,
            mediaType: mime_type || "application/octet-stream",
          },
        ],
      });
    }
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
    options?: { fromCheckpoint?: boolean; strategyOptions?: Record<string, unknown> }
  ): Promise<{ segmentStart: number; segmentEnd: number; replacementCount: number } | null> {
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
    this.checkpointMessageIndex = segment.start + result.replacementMessages.length;

    return {
      segmentStart: segment.start,
      segmentEnd: segment.end,
      replacementCount: result.replacementMessages.length,
    };
  }

  // Delegate to the internal runner
  async generateText(): Promise<ModelResponse> {
    return await this.runner.generateText(this);
  }

  async streamText(): Promise<ModelResponse> {
    return await this.runner.streamText(this);
  }

  async generateObject(schema: z.ZodSchema): Promise<ModelResponse> {
    return await this.runner.generateObject(this, schema);
  }

  async streamObject(schema: z.ZodSchema): Promise<ModelResponse> {
    return await this.runner.streamObject(this, schema);
  }

  // Access to underlying components when needed
  getRunner(): ModelRunner {
    return this.runner;
  }
}
