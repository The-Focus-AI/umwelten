import { CoreMessage } from "ai";
import { ModelDetails, ModelOptions } from "../models/types.js";
import path from "path";
import fs, { FileHandle } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { PathLike } from "fs";

export class Conversation {
  private messages: CoreMessage[] = [];
  public modelDetails: ModelDetails;
  public prompt: string;
  public options?: ModelOptions;

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
          { type: "image", image: data as string, mimeType: mime_type },
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
            mimeType: mime_type || "application/octet-stream",
          },
        ],
      });
    }
  }


  getMessages(): CoreMessage[] {
    return this.messages;
  }


  clearContext(): void {
    this.messages = [];
  }
}
