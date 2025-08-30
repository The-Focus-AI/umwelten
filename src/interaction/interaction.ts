import { CoreMessage } from "ai";
import { ModelDetails, ModelOptions } from "../cognition/types.js";
import { getAllTools } from "../stimulus/tools/index.js";
import path from "path";
import fs, { FileHandle } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { PathLike } from "fs";
import { z } from "zod";

export class Interaction {
  private messages: CoreMessage[] = [];
  public userId: string = "default";
  public modelDetails: ModelDetails;
  public prompt: string;
  public options?: ModelOptions;
  public outputFormat?: z.ZodSchema;
  public tools?: Record<string, any>;
  public maxSteps?: number;

  constructor(
    modelDetails: ModelDetails,
    prompt: string,
    options?: ModelOptions
  ) {
    this.modelDetails = modelDetails;
    this.prompt = prompt;
    this.options = options;
    this.messages.push({
      role: "system",
      content: this.prompt,
    });
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
}
