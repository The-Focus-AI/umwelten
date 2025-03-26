import { Command } from 'commander';
import { getAllModels, type ModelDetails } from '@model-eval/core/src/models/models';
import { estimateCost } from '@model-eval/core/src/costs/costs';
import chalk from 'chalk';

// Utility function to get visible length of string (excluding ANSI codes)
function visibleLength(str: string): number {
  // Remove ANSI escape codes when calculating length
  return str.replace(/\u001b\[\d+m/g, '').length;
}

// Utility function to pad string to visible length
function visiblePadEnd(str: string, length: number): string {
  const visLen = visibleLength(str);
  return str + ' '.repeat(Math.max(0, length - visLen));
}

// Utility function for consistent headers
function printHeader(text: string) {
  console.log('\n' + chalk.bold.blue(text));
}

// Utility function to format costs
function formatModelCosts(model: ModelDetails): string {
  if (!model.costs || (model.costs.promptTokens === 0 && model.costs.completionTokens === 0)) {
    return chalk.green('Free');
  }
  return `${chalk.yellow('Prompt')}: ${chalk.cyan('$' + model.costs.promptTokens.toFixed(4))}/1K tokens, ${chalk.yellow('Completion')}: ${chalk.cyan('$' + model.costs.completionTokens.toFixed(4))}/1K tokens`;
}

// Utility function to format model details
function formatModelDetails(model: ModelDetails): string {
  const details = [];
  if (model.details) {
    if (model.details.family) details.push(`${chalk.yellow('Family')}: ${model.details.family}`);
    if (model.details.format) details.push(`${chalk.yellow('Format')}: ${model.details.format}`);
    if (model.details.parameterSize) details.push(`${chalk.yellow('Size')}: ${model.details.parameterSize}`);
    if (model.details.quantizationLevel) details.push(`${chalk.yellow('Quantization')}: ${model.details.quantizationLevel}`);
  }
  return details.length > 0 ? details.join(' | ') : chalk.dim('No additional details');
}

// Utility function to format a table row
function formatTableRow(columns: string[], widths: number[]): string {
  return '│ ' + columns.map((col, i) => visiblePadEnd(col, widths[i])).join(' │ ') + ' │';
}

// Utility function to create a table separator
function createTableSeparator(widths: number[]): string {
  return '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
}

// Utility function to create a table header separator
function createTableHeaderSeparator(widths: number[]): string {
  return '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
}

// Utility function to create a table footer separator
function createTableFooterSeparator(widths: number[]): string {
  return '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';
}

// Utility function to truncate string with ellipsis
function truncate(str: string, length: number): string {
  const visLen = visibleLength(str);
  if (visLen <= length) return str;
  return str.slice(0, Math.max(0, length - 3)) + '...';
}

export const modelsCommand = new Command('models')
  .description('Manage and inspect available models');

// models list command
modelsCommand
  .command('list')
  .description('List all available models')
  .option('-p, --provider <provider>', 'Filter by provider (openrouter/ollama)')
  .option('--free-only', 'Show only free models')
  .option('-v, --verbose', 'Show detailed information')
  .option('--sort <field>', 'Sort by field (name, context, cost)', 'name')
  .action(async (options) => {
    try {
      console.log(chalk.dim('\nFetching available models...'));
      const models = await getAllModels();

      // Apply filters
      let filteredModels = models;
      if (options.provider) {
        filteredModels = filteredModels.filter(m => m.provider === options.provider);
      }
      if (options.freeOnly) {
        filteredModels = filteredModels.filter(m => !m.costs || (m.costs.promptTokens === 0 && m.costs.completionTokens === 0));
      }

      // Sort models within each provider group
      const sortModels = (models: ModelDetails[]) => {
        return [...models].sort((a, b) => {
          switch (options.sort) {
            case 'context':
              return b.contextLength - a.contextLength;
            case 'cost':
              const aCost = !a.costs ? 0 : (a.costs.promptTokens + a.costs.completionTokens);
              const bCost = !b.costs ? 0 : (b.costs.promptTokens + b.costs.completionTokens);
              return aCost - bCost;
            case 'name':
            default:
              return a.id.localeCompare(b.id);
          }
        });
      };

      // Group by provider
      const grouped = filteredModels.reduce((acc, model) => {
        // Fix Ollama context lengths - they vary by model
        if (model.provider === 'ollama') {
          // These are approximate values based on model sizes
          switch (true) {
            case model.id.includes('7b'):
              model.contextLength = 4096;
              break;
            case model.id.includes('13b'):
              model.contextLength = 8192;
              break;
            case model.id.includes('34b'):
              model.contextLength = 16384;
              break;
            case model.id.includes('70b'):
              model.contextLength = 32768;
              break;
            default:
              // Default to 4096 if we can't determine
              model.contextLength = 4096;
          }
        }
        
        if (!acc[model.provider]) acc[model.provider] = [];
        acc[model.provider].push(model);
        return acc;
      }, {} as Record<string, ModelDetails[]>);

      // Display results
      console.log(chalk.bold(`\nFound ${chalk.green(filteredModels.length)} models\n`));
      
      // Define column widths (for visible content)
      const widths = [45, 18, 15];
      if (options.verbose) widths.push(25);
      
      for (const [provider, providerModels] of Object.entries(grouped)) {
        printHeader(`${provider.toUpperCase()} (${providerModels.length} models)`);
        
        // Print table top border
        console.log(chalk.dim(createTableHeaderSeparator(widths)));
        
        // Print table header
        const headers = ['Model ID', 'Context Length', 'Cost'];
        if (options.verbose) headers.push('Details');
        console.log(chalk.dim(formatTableRow(
          headers.map(h => chalk.yellow.bold(h)),
          widths
        )));
        
        // Print header separator
        console.log(chalk.dim(createTableSeparator(widths)));
        
        // Sort and print rows
        sortModels(providerModels).forEach((model, index) => {
          const modelId = chalk.cyan(model.id);
          const costDisplay = !model.costs || (model.costs.promptTokens === 0 && model.costs.completionTokens === 0)
            ? chalk.green('Free')
            : chalk.cyan(`$${(model.costs.promptTokens + model.costs.completionTokens).toFixed(4)}/1K`);
          
          const details = options.verbose
            ? model.details?.family || model.details?.parameterSize || chalk.dim('No details')
            : '';
            
          const columns = [
            modelId,
            `${model.contextLength.toLocaleString()} tokens`,
            costDisplay
          ];
          
          if (options.verbose) {
            columns.push(truncate(details, 23));
          }
          
          console.log(chalk.dim(formatTableRow(columns, widths)));
          
          // Add separator between rows except for the last row
          if (index < providerModels.length - 1) {
            console.log(chalk.dim(createTableSeparator(widths)));
          }
        });
        
        // Print table bottom border
        console.log(chalk.dim(createTableFooterSeparator(widths)));
        console.log(); // Add spacing between provider sections
      }
    } catch (error) {
      console.error(chalk.red('\nError fetching models:'), error);
      process.exit(1);
    }
  });

// models info command
modelsCommand
  .command('info')
  .description('Show detailed information about a specific model')
  .argument('<model-id>', 'The ID of the model to inspect')
  .action(async (modelId) => {
    try {
      const models = await getAllModels();
      const model = models.find(m => m.id === modelId || m.name === modelId);
      
      if (!model) {
        console.error(chalk.red(`\nModel "${modelId}" not found`));
        process.exit(1);
      }

      printHeader('Model Information');
      console.log(`${chalk.yellow('Name')}: ${chalk.bold(model.name)}`);
      console.log(`${chalk.yellow('ID')}: ${model.id}`);
      console.log(`${chalk.yellow('Provider')}: ${chalk.cyan(model.provider)}`);
      console.log(`${chalk.yellow('Context Length')}: ${model.contextLength.toLocaleString()} tokens`);
      console.log(`${chalk.yellow('Cost')}: ${formatModelCosts(model)}`);
      console.log(`${chalk.yellow('Details')}: ${formatModelDetails(model)}`);

      // Show example cost estimates
      if (model.costs) {
        printHeader('Example Costs');
        const examples = [
          { prompt: 100, completion: 50 },
          { prompt: 500, completion: 200 },
          { prompt: 1000, completion: 500 }
        ];

        examples.forEach(({ prompt, completion }) => {
          const cost = estimateCost(model, prompt, completion);
          if (cost) {
            console.log(chalk.bold(`\n${prompt.toLocaleString()} prompt + ${completion.toLocaleString()} completion tokens:`));
            console.log(`  ${chalk.yellow('Prompt cost')}:     ${chalk.cyan('$' + cost.promptCost.toFixed(4))}`);
            console.log(`  ${chalk.yellow('Completion cost')}: ${chalk.cyan('$' + cost.completionCost.toFixed(4))}`);
            console.log(`  ${chalk.yellow('Total cost')}:      ${chalk.cyan('$' + cost.totalCost.toFixed(4))}`);
          }
        });
      }
    } catch (error) {
      console.error(chalk.red('\nError fetching model information:'), error);
      process.exit(1);
    }
  });

// models costs command
modelsCommand
  .command('costs')
  .description('Show cost information for all models')
  .option('--sort-by <field>', 'Sort by field (prompt/completion/total)', 'total')
  .action(async (options) => {
    try {
      const models = await getAllModels();
      const paidModels = models.filter(m => m.costs);

      // Calculate total cost for 1K tokens (both prompt and completion)
      const modelsWithTotalCost = paidModels.map(model => ({
        ...model,
        totalCostPer1K: model.costs ? 
          (model.costs.promptTokens + model.costs.completionTokens) : 0
      }));

      // Sort models
      modelsWithTotalCost.sort((a, b) => {
        if (!a.costs || !b.costs) return 0;
        switch (options.sortBy) {
          case 'prompt':
            return a.costs.promptTokens - b.costs.promptTokens;
          case 'completion':
            return a.costs.completionTokens - b.costs.completionTokens;
          default:
            return a.totalCostPer1K - b.totalCostPer1K;
        }
      });

      printHeader('Model Costs (per 1K tokens)');
      console.log(
        chalk.bold(chalk.cyan('Model'.padEnd(40))),
        chalk.bold(chalk.yellow('Prompt'.padEnd(15))),
        chalk.bold(chalk.yellow('Completion'.padEnd(15))),
        chalk.bold(chalk.yellow('Total'))
      );
      console.log(chalk.dim('─'.repeat(80)));

      modelsWithTotalCost.forEach(model => {
        if (!model.costs) return;
        console.log(
          chalk.cyan(model.name.padEnd(40)),
          `$${model.costs.promptTokens.toFixed(4)}`.padEnd(15),
          `$${model.costs.completionTokens.toFixed(4)}`.padEnd(15),
          chalk.bold(`$${model.totalCostPer1K.toFixed(4)}`)
        );
      });

      // Show free models at the end
      const freeModels = models.filter(m => !m.costs || (m.costs.promptTokens === 0 && m.costs.completionTokens === 0));
      if (freeModels.length > 0) {
        printHeader('Free Models');
        freeModels.forEach(model => {
          console.log(`${chalk.cyan(model.name)} ${chalk.dim(`(${model.provider})`)}`);
        });
      }
    } catch (error) {
      console.error(chalk.red('\nError fetching model costs:'), error);
      process.exit(1);
    }
  }); 