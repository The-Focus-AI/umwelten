import { Command } from 'commander';
import { getModel } from '@model-eval/core/src/providers/index.js';
import { ModelDetails } from '@model-eval/core/src/models/types.js';
import { generateText } from 'ai';

export const runCommand = new Command('run')
  .description('Run a prompt through a model')
  .argument('<prompt>', 'The prompt to send to the model')
  .requiredOption('-m, --model <model>', 'Model to use')
  .requiredOption('-p, --provider <provider>', 'Provider of the model')
  .action(async (prompt: string, options: { model: string, provider: string }) => {
    try {
      const modelDetails: ModelDetails = {
        name: options.model,
        provider: options.provider
      };

      console.log(`Fetching model details for ${options.model} from provider ${options.provider}...`);
      const model = await getModel(modelDetails);

      if (!model) {
        console.error('Failed to fetch model details.');
        process.exit(1);
      }

      console.log(`Running prompt through ${options.model}...`);
      const response = await generateText({
        model,
        prompt,
      });
      console.log('Response:', response.text);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  }); 