import { toVercelToolSet } from "../stimulus/tools/index.js";
import path from "path";
import fs from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
export class Interaction {
    constructor(modelDetails, prompt, options) {
        this.messages = [];
        this.userId = "default";
        this.modelDetails = modelDetails;
        this.prompt = prompt;
        this.options = options;
        this.messages.push({
            role: "system",
            content: this.prompt,
        });
    }
    addMessage(message) {
        this.messages.push(message);
    }
    async addAttachmentFromPath(attachment, mime_type) {
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
                    { type: "image", image: data },
                ],
            });
        }
        else {
            this.addMessage({
                role: "user",
                content: [
                    { type: "text", text: `I've shared a file named ${filename} for you to analyze.` },
                    {
                        type: "file",
                        data: data,
                        mediaType: mime_type || "application/octet-stream",
                    },
                ],
            });
        }
    }
    setOutputFormat(outputFormat) {
        this.outputFormat = outputFormat;
    }
    /**
     * Set tools for this interaction
     */
    setTools(tools) {
        this.tools = tools;
    }
    /**
     * Set maximum number of steps for multi-step tool calling
     */
    setMaxSteps(maxSteps) {
        this.maxSteps = maxSteps;
    }
    /**
     * Get tools in Vercel AI SDK format
     */
    getVercelTools() {
        return this.tools ? toVercelToolSet(this.tools) : undefined;
    }
    /**
     * Check if this interaction has tools
     */
    hasTools() {
        return this.tools !== undefined && Object.keys(this.tools).length > 0;
    }
    getMessages() {
        return this.messages;
    }
    clearContext() {
        this.messages = [];
    }
}
//# sourceMappingURL=interaction.js.map