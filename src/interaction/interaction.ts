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
    this.setSystemPrompt(stimulus.getPrompt());
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
