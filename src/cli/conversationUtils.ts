import { Interaction } from '../interaction/interaction.js';
import path from 'path';
import fs from 'fs';
import { fileTypeFromBuffer } from 'file-type';

export async function setupConversation({ modelDetails, prompt, attach, debug, systemPrompt }: {
  modelDetails: any,
  prompt: string,
  attach?: string,
  debug?: boolean,
  systemPrompt?: string
}): Promise<Interaction> {
  const conversation = new Interaction(
    modelDetails,
    systemPrompt || 'You are now in an interactive chat session.'
  );
  if (attach && prompt) {
    // Combine prompt and attachment into a single user message (array of parts)
    if (process.env.DEBUG === '1') console.log(`[DEBUG] Attaching file and combining with prompt: ${attach}`);
    try {
      const filename = path.basename(attach);
      const fileBuffer = fs.readFileSync(attach);
      const fileType = await fileTypeFromBuffer(fileBuffer);
      const mime_type = fileType?.mime || 'application/octet-stream';
      const data = fileBuffer.toString('base64');
      if (mime_type.startsWith('image/')) {
        conversation.addMessage({
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image: data },
          ],
        });
      } else {
        conversation.addMessage({
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'file', data: data, mediaType: mime_type },
          ],
        });
      }
      if (process.env.DEBUG === '1') console.log(`[DEBUG] File attached and combined with prompt successfully: ${attach}`);
    } catch (err) {
      console.error(`[ERROR] Failed to attach file: ${attach}`);
      if (debug) {
        console.error(err);
      }
      process.exit(1);
    }
  } else if (attach) {
    // Only attachment, no prompt
    if (process.env.DEBUG === '1') console.log(`[DEBUG] Attaching file: ${attach}`);
    try {
      await conversation.addAttachmentFromPath(attach);
      if (process.env.DEBUG === '1') console.log(`[DEBUG] File attached successfully: ${attach}`);
    } catch (err) {
      console.error(`[ERROR] Failed to attach file: ${attach}`);
      if (debug) {
        console.error(err);
      }
      process.exit(1);
    }
  } else if (prompt) {
    conversation.addMessage({ role: 'user', content: prompt });
  }
  return conversation;
} 