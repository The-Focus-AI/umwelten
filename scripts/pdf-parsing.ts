import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { EvaluationRunner } from '../src/evaluation/runner.js';

export async function parsePDF(pdfPath: string, model: ModelDetails): Promise<ModelResponse> {
  const prompt = "Analyze this PDF and provide a summary of the content.";

  const conversation = new Conversation(model, prompt);

  // conversation.addAttachmentFromPath(pdfFile);
  conversation.addAttachmentFromPath(pdfPath);

  const modelRunner = new BaseModelRunner();

  const response = await modelRunner.streamText(conversation);

  return response;
}

class PDFParser extends EvaluationRunner {
  private pdfPath: string;

  constructor(evaluationId: string, pdfPath: string) {
    super(evaluationId);
    this.pdfPath = path.resolve(this.getTestDataDir(), pdfPath);
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return parsePDF(this.pdfPath, details);
  }
}


const runner = new PDFParser('pdf-parsing', 'Home-Cooked Software and Barefoot Developers.pdf');

await runner.evaluate({
  name: 'gemma3:12b',
  provider: 'ollama',
});

await runner.evaluate({
  name: 'qwen2.5:14b',
  provider: 'ollama',
});

await runner.evaluate({
  name: 'phi4:latest',
  provider: 'ollama',
});

await runner.evaluate({
  name: 'phi4-mini:latest',
  provider: 'ollama',
});

await runner.evaluate({
  name: 'gemini-2.0-flash',
  provider: 'google',
});

await runner.evaluate({
  name: 'gemini-2.5-pro-exp-03-25',
  provider: 'google',
});

