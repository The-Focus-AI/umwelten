import { getModel, validateModel } from '../src/providers/index.js';
import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';

async function testGemma3Model() {
  const modelInfo:ModelDetails = {
    name: 'gemma3:12b',
    provider: 'ollama',
  };

  const model = await validateModel(modelInfo);
  if(!model) {
    console.error(`Failed to fetch model ${modelInfo.name} from provider ${modelInfo.provider}.`);
    process.exit(1);
  }

  const prompt = 'Write a short poem about a cat.';

  const modelRunner = new BaseModelRunner();
  const conversation = new Conversation(model, prompt);
  try {
    console.log('Generating text for gemma3:12b using BaseModelRunner...');
    const response = await modelRunner.stream(conversation);

    console.log('Generated text for gemma3:12b:', response.content);

    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error generating text:', error);
  }
}

testGemma3Model(); 