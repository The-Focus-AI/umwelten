import { Command } from 'commander';

export const runCommand = new Command('run')
  .description('Run a prompt through a model')
  .argument('<prompt>', 'The prompt to send to the model')
  .option('-m, --model <model>', 'Model to use', 'mistral')
  .action(async (prompt: string, options: { model: string }) => {
    try {
      console.log(`Running prompt through ${options.model}...`);
      console.log('Prompt:', prompt);
      // TODO: Implement actual model execution
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  }); 