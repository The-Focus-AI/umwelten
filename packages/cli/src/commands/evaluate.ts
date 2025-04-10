import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { EvaluationRunner } from '@model-eval/core/src/evaluation/runner.js';
import { 
  EvaluationConfig,
  EvaluationResults,
  ModelEvaluationResult,
  PromptConfigSchema,
  RubricConfigSchema,
  ModelsConfigSchema
} from '@model-eval/core/src/evaluation/types.js';
import { loadEvaluationConfig } from '@model-eval/core/src/evaluation/config.js';
import chalk from 'chalk';
import ora from 'ora';
import { config } from 'dotenv';

// Load environment variables from .env file
const envPath = resolve(process.cwd(), '.env');
const result = config({
  path: envPath
});

if (result.error) {
  console.warn(chalk.yellow('⚠️ Failed to load .env file:', result.error.message));
  console.warn(chalk.yellow('Some features may not work without required environment variables.'));
}

const DEFAULT_OUTPUT_DIR = 'output/evaluations';

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-');
}

async function loadConfig(path: string): Promise<EvaluationConfig> {
  try {
    const configStr = readFileSync(resolve(path), 'utf-8');
    const config = JSON.parse(configStr);

    // Validate each section using the core schemas
    const prompt = PromptConfigSchema.parse(config.prompt);
    const rubric = RubricConfigSchema.parse(config.rubric);
    const models = ModelsConfigSchema.parse(config.models);

    return { prompt, rubric, models };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

function formatResults(results: EvaluationResults, format: string): string {
  if (format === 'json') {
    return JSON.stringify(results, null, 2);
  }

  // Text format
  let output = '';
  output += chalk.bold(`\nEvaluation Results for "${results.promptConfig.title}"\n`);
  output += '='.repeat(50) + '\n\n';

  for (const result of results.results) {
    output += chalk.blue(`Model: ${result.modelId} (${result.provider})\n`);
    output += '-'.repeat(30) + '\n';
    output += `Response:\n${result.response}\n\n`;
    output += 'Scores:\n';
    
    for (const score of result.scores) {
      output += chalk.yellow(`${score.criterion}: ${score.score}/${score.maxPoints}\n`);
      output += `Reasoning: ${score.reasoning}\n\n`;
    }

    output += chalk.green(`Total Score: ${result.totalScore}\n`);
    output += `Tokens Used: ${result.metadata.tokensUsed}\n`;
    output += `Cost: $${(result.metadata.cost * 1000000).toFixed(4)} per million tokens\n\n`;
  }

  output += chalk.bold('Summary\n');
  output += '-'.repeat(20) + '\n';
  output += `Total Cost: $${(results.metadata.totalCost * 1000000).toFixed(4)} per million tokens\n`;
  output += `Duration: ${(results.metadata.endTime.getTime() - results.metadata.startTime.getTime()) / 1000}s\n`;

  return output;
}

export const evaluateCommand = new Command('evaluate')
  .description('Run model evaluations based on a configuration file')
  .requiredOption('-c, --config <path>', 'Path to evaluation config file')
  .option('-o, --output <path>', 'Path to write evaluation results')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-f, --format <format>', 'Output format (json or text)', 'text')
  .action(async (options) => {
    try {
      // Ensure the output directory exists
      if (!existsSync(DEFAULT_OUTPUT_DIR)) {
        mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
      }

      // Load and validate config
      const config = await loadConfig(options.config);
      console.log(chalk.green('Configuration loaded successfully'));

      if (options.verbose) {
        console.log(chalk.dim('Loaded Configuration:', JSON.stringify(config, null, 2)));
      }

      // Add verbose flag to the configuration
      config.verbose = options.verbose;

      // Run evaluation
      console.log('Running evaluation...');
      const runner = new EvaluationRunner();
      const results = await runner.runEvaluation(config);
      console.log(chalk.green('Evaluation completed successfully'));

      // Always store results in JSON format
      const jsonResults = JSON.stringify(results, null, 2);

      // Determine output path
      const outputPath = options.output || `${DEFAULT_OUTPUT_DIR}/evaluation-${getTimestamp()}.json`;

      writeFileSync(resolve(outputPath), jsonResults);
      console.log(chalk.green(`\nResults written to ${outputPath}`));

      // Optionally print formatted results to console
      if (options.format === 'text') {
        const formattedResults = formatResults(results, 'text');
        console.log(formattedResults);
      }

      if (options.verbose) {
        console.log(chalk.dim('\nDebug Information:'));
        console.log(chalk.dim('Evaluation ID:', results.metadata.evaluationId));
        console.log(chalk.dim('Start Time:', results.metadata.startTime.toISOString()));
        console.log(chalk.dim('End Time:', results.metadata.endTime.toISOString()));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red('\nError:'), error.message);
        if (options.verbose) {
          console.error(chalk.dim('\nStack trace:'), error.stack);
        }
        process.exit(1);
      }
      throw error;
    }
  }); 