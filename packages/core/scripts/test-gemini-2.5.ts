import { validateModel } from '../src/providers/index.js';
import { BaseModelRunner } from '../src/model-runner.js';
import { ModelDetails } from '../src/models/types.js';
import { formatCostBreakdown } from '../src/costs/costs.js';

async function testGemma3Model() {
  const modelInfo:ModelDetails = {
    name: 'gemini-2.5-pro-exp-03-25',
    provider: 'google',
  };

  const model = await validateModel(modelInfo);
  if(!model) {
    console.error(`Failed to fetch model ${modelInfo.name} from provider ${modelInfo.provider}.`);
    process.exit(1);
  }

  console.log('Model:', JSON.stringify(model, null, 2));

  const prompt = 'Write a short poem about a cat.';

  const modelRunner = new BaseModelRunner();

  try {
    console.log('Generating text for gemma3:12b using BaseModelRunner...');
    const response = await modelRunner.execute({
      prompt,
      modelDetails: modelInfo,
    });

    console.log('Generated text for gemma3:12b:', response.content);

    console.log('Response:', JSON.stringify(response, null, 2));
  
    if (response.metadata.cost) {
      console.log('Cost breakdown:', formatCostBreakdown(response.metadata.cost));
    } else {
      console.log('Cost breakdown: Not available');
    }
  } catch (error) {
    console.error('Error generating text:', error);
  }
}

testGemma3Model(); 