import path from "path";
import fs from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { CoreMessage } from "ai";

export async function buildAttachmentMessage(
  filePath: string,
  mimeType?: string,
): Promise<CoreMessage> {
  const filename = path.basename(filePath);
  console.log("Creating attachment for", filename);
  const fileBuffer = await fs.readFile(filePath);
  if (!mimeType) {
    const fileType = await fileTypeFromBuffer(fileBuffer);
    mimeType = fileType?.mime;
  }

  // convert to base64
  const data = fileBuffer.toString("base64");

  if (mimeType && mimeType.startsWith("image/")) {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: `I've shared an image named ${filename} for you to analyze.`,
        },
        { type: "image", image: data as string },
      ],
    };
  } else {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: `I've shared a file named ${filename} for you to analyze.`,
        },
        {
          type: "file",
          data: data as string,
          mediaType: mimeType || "application/octet-stream",
        },
      ],
    };
  }
}
