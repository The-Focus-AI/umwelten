import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.resolve(__dirname, '../examples/audio');
const outputDir = path.resolve(__dirname, '../output/audio');

export const TranscriptionSchema = z.object({
  segments: z.array(
    z.object({
      timestamp: z.string().describe("Timestamp in MM:SS format indicating when this segment occurs in the audio"),

      speaker: z.string().min(1).describe("Name or identifier of the person speaking in this segment"),

      advertisement: z.boolean().describe("Indicates if this segment is part of an advertisement or sponsored content"),

      guest_interview: z.boolean().describe("Indicates if this segment is part of a guest interview"),

      topics: z.array(z.string().min(1)).min(1).describe("List of topics or themes discussed in this segment"),

      spoken_text: z.string().min(1).describe("The actual transcribed text of what was spoken in this segment"),
    }).describe("A segment of transcribed audio with metadata")
  ),
});

async function transcribeAudio(inputFile: string) {
  const model:ModelDetails = {
    name: 'gemini-2.5-pro-preview-03-25',
    provider: 'google',
  };

  const prompt = `You are a transcription agent that transcribes audio. You will be given a file and you will need to transcribe the audio.`;

  const conversation = new Conversation(model, prompt);

  conversation.addAttachmentFromPath(path.join(testDataDir, inputFile));

  conversation.addMessage({
    role: 'user',
    content: `Please transcribe the audio file ${inputFile}.`
  });

  // conversation.setOutputFormat(TranscriptionSchema);

  const modelRunner = new BaseModelRunner();

  const response = await modelRunner.streamObject(conversation, TranscriptionSchema);

  console.log('Response:', JSON.stringify(response, null, 2));
}

await transcribeAudio('heavyweight_small.mp3');