import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  EvaluationConfig,
  PromptConfig,
  RubricConfig,
  ModelsConfig,
  ModelConfig,
  PromptConfigSchema,
  RubricConfigSchema,
  ModelsConfigSchema,
  ModelConfigSchema
} from '@model-eval/core/src/evaluation/types.js';
import { getModelProvider } from '@model-eval/core/src/providers/index.js';

// Helper functions
function ensureDirectoryExists(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadJSON(path: string) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to load JSON from ${path}: ${error}`);
  }
}

function saveJSON(path: string, data: any) {
  try {
    writeFileSync(resolve(path), JSON.stringify(data, null, 2));
  } catch (error) {
    throw new Error(`Failed to save JSON to ${path}: ${error}`);
  }
}

// Command implementation
export const evalsCommand = new Command('evals')
  .description('Manage evaluation configurations')
  .addCommand(
    new Command('list')
      .description('List available evaluation configurations')
      .action(async () => {
        const configDir = resolve(process.cwd(), 'examples', 'evaluations');
        ensureDirectoryExists(configDir);
        
        const files = readdirSync(configDir)
          .filter((f: string) => f.endsWith('.json'));
        
        if (files.length === 0) {
          console.log(chalk.yellow('No evaluation configurations found.'));
          return;
        }

        console.log(chalk.bold('\nAvailable Evaluation Configurations:'));
        for (const file of files) {
          try {
            const config = loadJSON(join(configDir, file));
            console.log(chalk.blue(`\n${file}:`));
            console.log(`  Title: ${config.prompt.title}`);
            console.log(`  Models: ${config.models.models.length}`);
            console.log(`  Created: ${config.models.metadata.created}`);
          } catch (error) {
            console.log(chalk.red(`  Error loading ${file}: ${error}`));
          }
        }
      })
  )
  .addCommand(
    new Command('view')
      .description('View evaluation configuration details')
      .requiredOption('--config <path>', 'Path to evaluation config')
      .action(async (options) => {
        const spinner = ora('Loading configuration...').start();
        try {
          const config = loadJSON(options.config);
          spinner.succeed('Configuration loaded');

          console.log(chalk.bold('\nEvaluation Configuration:'));
          console.log(chalk.blue('\nPrompt:'));
          console.log(`  Title: ${config.prompt.title}`);
          console.log(`  Question: ${config.prompt.question}`);
          
          console.log(chalk.blue('\nRubric:'));
          console.log(`  Criteria: ${Object.keys(config.rubric.scoring_criteria).length} categories`);
          console.log(`  Total Points: ${Object.values(config.rubric.scoring_criteria)
            .reduce((sum: number, criterion: any) => sum + criterion.points, 0)}`);

          console.log(chalk.blue('\nModels:'));
          console.log(`  Evaluator: ${config.models.evaluator.modelId} (${config.models.evaluator.provider})`);
          console.log('\n  Test Models:');
          for (const model of config.models.models) {
            console.log(`  - ${model.modelId} (${model.provider})`);
          }

          console.log(chalk.blue('\nRequirements:'));
          for (const [key, value] of Object.entries(config.models.metadata.requirements)) {
            console.log(`  ${key}: ${value}`);
          }
        } catch (error) {
          spinner.fail('Failed to load configuration');
          console.error(chalk.red('Error:'), error);
        }
      })
  )
  .addCommand(
    new Command('add-model')
      .description('Add a model to an evaluation configuration')
      .requiredOption('--config <path>', 'Path to evaluation config')
      .requiredOption('--model <model-id>', 'Model ID to add')
      .requiredOption('--provider <provider>', 'Model provider')
      .option('--route <route>', 'Route (direct/openrouter/ollama)', 'direct')
      .option('--temp <temperature>', 'Temperature', '0.7')
      .option('--max-tokens <tokens>', 'Max tokens', '1000')
      .option('--top-p <top_p>', 'Top P', '0.95')
      .action(async (options) => {
        const spinner = ora('Loading configuration...').start();
        try {
          const config = loadJSON(options.config);
          spinner.succeed('Configuration loaded');

          // Check if model already exists (check both id and modelId)
          if (config.models.models.some((m: any) => 
              (m.modelId === options.model || m.id === options.model))) {
            console.log(chalk.yellow('Model already exists in configuration'));
            return;
          }

          // Add new model
          const newModel = {
            modelId: options.model,
            provider: options.provider,
            route: options.route,
            description: `${options.provider} model`,
            parameters: {
              temperature: parseFloat(options.temp),
              max_tokens: parseInt(options.maxTokens),
              top_p: parseFloat(options.topP)
            }
          };

          config.models.models.push(newModel);
          
          // Update requirements based on provider
          const requirements: {[key: string]: string} = {
            google: 'GOOGLE_GENERATIVE_AI_API_KEY',
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openrouter: 'OPENROUTER_API_KEY'
          };

          if (requirements[options.provider]) {
            config.models.metadata.requirements[requirements[options.provider]] = 
              `Required for ${options.provider} models`;
          }

          // Save updated config
          saveJSON(options.config, config);
          console.log(chalk.green(`Added model ${options.model} to configuration`));
        } catch (error) {
          spinner.fail('Failed to update configuration');
          console.error(chalk.red('Error:'), error);
        }
      })
  )
  .addCommand(
    new Command('remove-model')
      .description('Remove a model from an evaluation configuration')
      .requiredOption('--config <path>', 'Path to evaluation config')
      .requiredOption('--model <model-id>', 'Model ID to remove')
      .action(async (options) => {
        const spinner = ora('Loading configuration...').start();
        try {
          const config = loadJSON(options.config);
          spinner.succeed('Configuration loaded');

          const initialLength = config.models.models.length;
          config.models.models = config.models.models.filter(
            (m: any) => m.modelId !== options.model && m.id !== options.model
          );

          if (config.models.models.length === initialLength) {
            console.log(chalk.yellow('Model not found in configuration'));
            return;
          }

          // Save updated config
          saveJSON(options.config, config);
          console.log(chalk.green(`Removed model ${options.model} from configuration`));
        } catch (error) {
          spinner.fail('Failed to update configuration');
          console.error(chalk.red('Error:'), error);
        }
      })
  )
  .addCommand(
    new Command('create')
      .description('Create a new evaluation configuration')
      .requiredOption('--name <name>', 'Name for the evaluation')
      .requiredOption('--prompt <path>', 'Path to prompt template')
      .requiredOption('--rubric <path>', 'Path to rubric template')
      .option('--evaluator <model-id>', 'Evaluator model ID', 'gpt-4-turbo-preview')
      .option('--provider <provider>', 'Evaluator provider', 'openai')
      .option('--route <route>', 'Evaluator route', 'direct')
      .action(async (options) => {
        const spinner = ora('Creating evaluation configuration...').start();
        try {
          // Load templates
          const prompt = loadJSON(options.prompt);
          const rubric = loadJSON(options.rubric);

          // Create evaluation config
          const config = {
            prompt,
            rubric,
            models: {
              evaluator: {
                id: options.evaluator,
                provider: options.provider,
                route: options.route,
                description: `${options.provider} model for evaluation`
              },
              models: [],
              metadata: {
                created: new Date().toISOString().split('T')[0],
                version: '1.0',
                notes: `Evaluation configuration for ${options.name}`,
                requirements: {} as Record<string, string>
              }
            }
          };

          // Update requirements based on evaluator provider
          const requirements: {[key: string]: string} = {
            google: 'GOOGLE_GENERATIVE_AI_API_KEY',
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openrouter: 'OPENROUTER_API_KEY'
          };

          if (requirements[options.provider]) {
            config.models.metadata.requirements[requirements[options.provider]] = 
              `Required for ${options.provider} models`;
          }

          // Save config
          const configPath = resolve(process.cwd(), 'examples', 'evaluations', `${options.name}.json`);
          saveJSON(configPath, config);
          
          spinner.succeed(`Created evaluation configuration at ${configPath}`);
          console.log(chalk.green('\nNext steps:'));
          console.log('1. Add models to test with:');
          console.log(`   pnpm run cli evals add-model --config ${configPath} --model <model-id> --provider <provider>`);
          console.log('2. View the configuration:');
          console.log(`   pnpm run cli evals view --config ${configPath}`);
          console.log('3. Run the evaluation:');
          console.log(`   pnpm run cli evaluate -c ${configPath}`);
        } catch (error) {
          spinner.fail('Failed to create evaluation configuration');
          console.error(chalk.red('Error:'), error);
        }
      })
  )
  .addCommand(
    new Command('set-evaluator')
      .description('Change the evaluator model in an evaluation configuration')
      .requiredOption('--config <path>', 'Path to evaluation config')
      .requiredOption('--model <model-id>', 'Model ID for evaluator')
      .requiredOption('--provider <provider>', 'Model provider')
      .option('--route <route>', 'Route (direct/openrouter/ollama)', 'direct')
      .action(async (options) => {
        const spinner = ora('Loading configuration...').start();
        try {
          const config = loadJSON(options.config);
          spinner.succeed('Configuration loaded');

          // Store old evaluator for logging
          const oldEvaluator = { ...config.models.evaluator };

          // Update evaluator
          config.models.evaluator = {
            modelId: options.model,
            provider: options.provider,
            route: options.route,
            description: `${options.model} for evaluation`
          };

          // Update requirements based on provider
          const requirements: {[key: string]: string} = {
            google: 'GOOGLE_GENERATIVE_AI_API_KEY',
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            openrouter: 'OPENROUTER_API_KEY'
          };

          if (requirements[options.provider]) {
            config.models.metadata.requirements[requirements[options.provider]] = 
              `Required for ${options.provider} models`;
          }

          // Save updated config
          saveJSON(options.config, config);
          console.log(chalk.green(`Changed evaluator model from ${oldEvaluator.modelId} to ${options.model}`));
          console.log(chalk.blue('New evaluator configuration:'));
          console.log(`  Model: ${config.models.evaluator.modelId}`);
          console.log(`  Provider: ${config.models.evaluator.provider}`);
          console.log(`  Route: ${config.models.evaluator.route}`);
        } catch (error) {
          spinner.fail('Failed to update configuration');
          console.error(chalk.red('Error:'), error);
        }
      })
  ); 