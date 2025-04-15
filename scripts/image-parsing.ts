import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { EvaluationRunner } from '../src/evaluation/runner.js';

export async function parseImage(imagePath: string, model: ModelDetails): Promise<ModelResponse> {
  const prompt = "Analyze this image and provide a summary of the content.";

  const conversation = new Conversation(model, prompt);

  // conversation.addAttachmentFromPath(pdfFile);
  conversation.addAttachmentFromPath(imagePath);

  const modelRunner = new BaseModelRunner();

  const response = await modelRunner.streamText(conversation);

  return response;
}

class ImageParser extends EvaluationRunner {
  private imagePath: string;

  constructor(evaluationId: string, imagePath: string) {
    super(evaluationId);
    this.imagePath = path.resolve(this.getTestDataDir(), imagePath);
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return parseImage(this.imagePath, details);
  }
}


const runner = new ImageParser('image-parsing', 'internet_archive_fffound.png');

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



/*


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testGemma3File() {
  const model:ModelDetails = {
    name: 'gemma3:12b',
    provider: 'ollama',
  };

  const testDataDir = path.resolve(__dirname, '../examples/test_data');
  const imageFile = path.join(testDataDir, 'internet_archive_fffound.png');
  const pdfFile = path.join(
    testDataDir,
    'Home-Cooked Software and Barefoot Developers.pdf'
  );

  const prompt = "Analyze this PDF and provide a summary of the content.";

  const conversation = new Conversation(model, prompt);

  // conversation.addAttachmentFromPath(pdfFile);
  conversation.addAttachmentFromPath(imageFile);

  const modelRunner = new BaseModelRunner();

  try {
    console.log('Generating text for gemma3:12b using BaseModelRunner...');
    const response = await modelRunner.stream(conversation);

    console.log('Generated text for gemma3:12b:', response.content);

    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error generating text:', error);
  }
}

testGemma3File();
*/