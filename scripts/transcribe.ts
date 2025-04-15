import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'fs';
import { EvaluationRunner } from '../src/evaluation/runner.js';
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

      topics: z.array(z.string()).describe("List of topics or themes discussed in this segment"),

      spoken_text: z.string().min(1).describe("The actual transcribed text of what was spoken in this segment"),
    }).describe("A segment of transcribed audio with metadata")
  ),
});

async function transcribeAudio(audioPath: string, model: ModelDetails): Promise<ModelResponse> {

  const prompt = `You are a transcription agent that transcribes audio. You will be given a file and you will need to transcribe the audio.`;

  const conversation = new Conversation(model, prompt);

  conversation.addAttachmentFromPath(audioPath);

  conversation.addMessage({
    role: 'user',
    content: `Please transcribe the audio file ${audioPath}.`
  });

  const modelRunner = new BaseModelRunner();

  const response = await modelRunner.streamObject(conversation, TranscriptionSchema);

  return response;
}

class Transcriber extends EvaluationRunner {
  private inputFile: string;

  constructor(evaluationId: string, inputFile: string) {
    super(evaluationId);
    this.inputFile = path.resolve(this.getTestDataDir(), inputFile);
  }
  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return await transcribeAudio(this.inputFile, details);
  }
}

let runner: Transcriber;
/*
runner = new Transcriber('long-podcast', 'smaller.mp3');

runner.evaluate({
  name: 'gemini-2.0-flash',
  provider: 'google',
});

runner.evaluate({
  name: 'openrouter/optimus-alpha',
  provider: 'openrouter',
});
*/
runner = new Transcriber('transcribe/heavyweight', 'heavyweight_small.mp3');
runner.evaluate({
  name: 'gemini-2.0-flash',
  provider: 'google',
});

runner.evaluate({
  name: 'gemini-2.5-pro-exp-03-25',
  provider: 'google',
});
