import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testGemma3File() {
  const model:ModelDetails = {
    name: 'gemma3:12b',
    provider: 'ollama',
  };

  const testDataDir = path.resolve(__dirname, '../../../examples/test_data');
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
