import { Command } from 'commander';
import { getAllModels, searchModels } from '../models/models.js';
import { estimateCost } from '../costs/costs.js';
import { getModelUrl } from '../providers/index.js';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { ModelDetails } from '../models/types.js';
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

// Utility function to right align text to visible length
function visiblePadStart(str: string, length: number): string {
  const visLen = visibleLength(str);
  return ' '.repeat(Math.max(0, length - visLen)) + str;
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
  return `${chalk.yellow('Input Cost')}: ${chalk.cyan('$' + (model.costs.promptTokens * 1000000).toFixed(4))}/1M tokens, ${chalk.yellow('Output Cost')}: ${chalk.cyan('$' + (model.costs.completionTokens * 1000000).toFixed(4))}/1M tokens`;
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

// Utility function to format context length
function formatContextLength(tokens: number | undefined): string {
  if (!tokens) return 'Unknown';
  if (tokens >= 1000000) {
    return `${Math.round(tokens / 1000000)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return tokens.toString();
}

type Provider = 'openrouter' | 'ollama' | 'google' | 'all';
type SortField = 'name' | 'addedDate' | 'contextLength' | 'cost';
type ViewMode = 'list' | 'info' | 'costs';

interface CommandOptions {
  search?: string;
  provider?: Provider;
  sort?: SortField;
  desc?: boolean;
  free?: boolean;
  json?: boolean;
  view?: ViewMode;
  id?: string;
}

function formatCost(model: ModelDetails): string {
  if (model.provider === 'ollama') return chalk.green('Free');
  if (!model.costs) return chalk.green('Free');
  
  const totalCost = (model.costs.promptTokens + model.costs.completionTokens) * 1000000;
  return totalCost === 0 ? chalk.green('Free') : chalk.cyan(`$${totalCost.toFixed(3)} per million tokens`);
}

function displayModelInfo(model: ModelDetails) {
  console.log('\nModel Details:');
  console.log('=============');
  console.log(`ID: ${model.name}`);
  console.log(`Name: ${model.name}`);
  console.log(`Provider: ${model.provider}`);
  if (model.provider === 'openrouter' && model.details?.provider) {
    console.log(`Model Provider: ${model.details.provider}`);
  }
  
  const url = getModelUrl(model);
  if (url) {
    // Using OSC 8 escape sequence for clickable links in terminal
    console.log(`URL: \x1b]8;;${url}\x1b\\${chalk.cyan(url)}\x1b]8;;\x1b\\`);
  }
  
  console.log(`Context Length: ${formatContextLength(model.contextLength)} tokens`);
  console.log(`Cost per 1K tokens: ${formatCost(model)}`);
  if (model.addedDate) console.log(`Added: ${formatDate(model.addedDate)}`);
  if (model.lastUpdated) console.log(`Last Updated: ${formatDate(model.lastUpdated)}`);
  
  if (model.details) {
    console.log('\nAdditional Details:');
    console.log('==================');
    Object.entries(model.details).forEach(([key, value]) => {
      if (key !== 'provider') { // Skip provider since we already showed it
        console.log(`${key}: ${value}`);
      }
    });
  }
}

function formatDate(date: Date | undefined): string {
  if (!date) return 'Unknown';
  // Format as MM/DD/YY
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit'
  });
}

export const modelsCommand = new Command('models')
  .description('List and search available models')
  .option('-s, --search <query>', 'Search for models by name or description')
  .option('-p, --provider <provider>', 'Filter by provider (openrouter, ollama, google, all)', 'all')
  .option('--sort <field>', 'Sort by field (name, addedDate, contextLength, cost)', 'name')
  .option('--desc', 'Sort in descending order')
  .option('--free', 'Show only free models')
  .option('--json', 'Output in JSON format')
  .option('--view <mode>', 'Display mode: list (default), info, costs')
  .option('--id <model-id>', 'Model ID for detailed view')
  .action(async (options: CommandOptions) => {
    try {
      // Handle EPIPE errors (e.g., when piping to head)
      process.stdout.on('error', (err) => {
        if (err.code === 'EPIPE') {
          process.exit(0);
        }
      });

      // Check if --id is required but missing
      if (options.view === 'info' && !options.id) {
        console.error('Error: --id <model-id> is required for detailed view');
        process.exit(1);
      }

      // Get all models first
      let models = await getAllModels();

      // Filter by provider if specified
      if (options.provider && options.provider !== 'all') {
        models = models.filter(m => m.provider === options.provider);
      }

      // Filter free models if requested
      if (options.free) {
        models = models.filter(m => {
          if (m.provider === 'ollama') return true;
          if (!m.costs) return true;
          return m.costs.promptTokens === 0 && m.costs.completionTokens === 0;
        });
      }

      // Search if query provided
      if (options.search) {
        models = await searchModels(options.search, models);
      }

      // Handle model info view
      if (options.view === 'info' && options.id) {
        const model = models.find(m => m.name === options.id);
        if (!model) {
          console.error(`Error: Model with ID "${options.id}" not found`);
          process.exit(1);
        }
        displayModelInfo(model);
        return;
      }

      // Sort models
      if (options.sort) {
        models = [...models].sort((a, b) => {
          switch (options.sort) {
            case 'name':
              return options.desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
            case 'addedDate':
              const dateA = a.addedDate?.getTime() || 0;
              const dateB = b.addedDate?.getTime() || 0;
              return options.desc ? dateB - dateA : dateA - dateB;
            case 'contextLength':
              const lenA = a.contextLength || 0;
              const lenB = b.contextLength || 0;
              return options.desc ? lenB - lenA : lenA - lenB;
            case 'cost':
              const costA = a.costs ? (a.costs.promptTokens + a.costs.completionTokens) : 0;
              const costB = b.costs ? (b.costs.promptTokens + b.costs.completionTokens) : 0;
              return options.desc ? costB - costA : costA - costB;
            default:
              return 0;
          }
        });
      }

      // Output results
      if (options.json) {
        console.log(JSON.stringify(models, null, 2));
      } else {
        // Display table format
        console.log(`\nFound ${models.length} models\n`);
        const table = new Table({
          head: ['ID', 'Provider', 'Context', 'Input Cost/1M', 'Output Cost/1M', 'Added'],
          style: { head: ['blue'] }
        });

        models.forEach(model => {
          table.push([
            model.name,
            model.provider,
            formatContextLength(model.contextLength),
            model.costs ? `$${(model.costs.promptTokens * 1000000).toFixed(4)}` : '$0.0000',
            model.costs ? `$${(model.costs.completionTokens * 1000000).toFixed(4)}` : '$0.0000',
            model.addedDate ? formatDate(model.addedDate) : 'Unknown'
          ]);
        });

        console.log(table.toString());
        console.log('\nTip: Use --json for machine-readable output');
        console.log('     Use --view info --id <model-id> for detailed information about a specific model');
      }
    } catch (error) {
      console.error('Error fetching models:', error);
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
      const model = models.find(m => m.name === modelId);
      
      if (!model) {
        console.error(chalk.red(`\nModel "${modelId}" not found`));
        process.exit(1);
      }

      printHeader('Model Information');
      console.log(`${chalk.yellow('Name')}: ${chalk.bold(model.name)}`);
      console.log(`${chalk.yellow('Provider')}: ${chalk.cyan(model.provider)}`);
      
      const url = getModelUrl(model);
      if (url) {
        console.log(`${chalk.yellow('URL')}: \x1b]8;;${url}\x1b\\${chalk.cyan(url)}\x1b]8;;\x1b\\`);
        console.log(chalk.dim('(URL is clickable in most modern terminals)'));
      }
      
      console.log(`${chalk.yellow('Context Length')}: ${chalk.cyan(formatContextLength(model.contextLength))} tokens`);
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
    } catch (error) {
      console.error('Error fetching model costs:', error);
      process.exit(1);
    }
  });