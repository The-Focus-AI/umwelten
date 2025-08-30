import { Command } from 'commander';
import { getAllModels, searchModels } from '../cognition/models.js';
import { estimateCost } from '../costs/costs.js';
import { getModelUrl } from '../providers/index.js';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { ModelDetails } from '../cognition/types.js';
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
  
  const inputCostPerM = model.costs.promptTokens * 1000000;
  const outputCostPerM = model.costs.completionTokens * 1000000;
  
  return `${chalk.yellow('Input Cost')}: ${chalk.cyan('$' + inputCostPerM.toFixed(4))}/1M tokens, ${chalk.yellow('Output Cost')}: ${chalk.cyan('$' + outputCostPerM.toFixed(4))}/1M tokens`;
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
  architecture?: string;
}

function formatCost(model: ModelDetails): string {
  if (model.provider === 'ollama' || model.provider === 'github-models') return chalk.green('Free');
  if (!model.costs) return chalk.green('Free');
  
  // Costs are already in per-million-tokens format, no need to multiply again
  const inputCostPerM = model.costs.promptTokens;
  const outputCostPerM = model.costs.completionTokens;
  
  if (inputCostPerM === 0 && outputCostPerM === 0) return chalk.green('Free');
  
  const parts = [];
  if (inputCostPerM > 0) parts.push(`Input: $${inputCostPerM.toFixed(4)}/1M`);
  if (outputCostPerM > 0) parts.push(`Output: $${outputCostPerM.toFixed(4)}/1M`);
  
  return chalk.cyan(parts.join(', '));
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
  console.log(`Cost per 1M tokens: ${formatCost(model)}`);
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
  .option('-p, --provider <provider>', 'Filter by provider (openrouter, ollama, google, github-models, all)', 'all')
  .option('--sort <field>', 'Sort by field (name, addedDate, contextLength, cost)', 'name')
  .option('--desc', 'Sort in descending order')
  .option('--free', 'Show only free models')
  .option('--json', 'Output in JSON format')
  .option('--view <mode>', 'Display mode: list (default), info, costs')
  .option('--id <model-id>', 'Model ID for detailed view')
  .option('--architecture <type>', 'Filter by architecture type (e.g., text->text)')
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

      // Filter by architecture if specified
      if (options.architecture) {
        models = models.filter(m => m.details?.architecture === options.architecture);
      }

      // Filter free models if requested
      if (options.free) {
        models = models.filter(m => {
          if (m.provider === 'ollama' || m.provider === 'github-models') return true;
          if (!m.costs) return true;
          return m.costs.promptTokens === 0 && m.costs.completionTokens === 0;
        });
      }

      // Search if query provided
      if (options.search) {
        models = await searchModels(options.search, models);
      }

      // Sort models
      if (options.sort) {
        models.sort((a, b) => {
          switch (options.sort) {
            case 'name':
              return (a.name || '').localeCompare(b.name || '');
            case 'addedDate':
              return (a.addedDate?.getTime() || 0) - (b.addedDate?.getTime() || 0);
            case 'contextLength':
              return (a.contextLength || 0) - (b.contextLength || 0);
            case 'cost':
              const aCost = a.costs ? a.costs.promptTokens + a.costs.completionTokens : 0;
              const bCost = b.costs ? b.costs.promptTokens + b.costs.completionTokens : 0;
              return aCost - bCost;
            default:
              return 0;
          }
        });

        // Reverse if descending order requested
        if (options.desc) {
          models.reverse();
        }
      }

      // Handle different view modes
      if (options.view === 'info') {
        const model = models.find(m => m.name === options.id);
        if (!model) {
          console.error(`Model with ID "${options.id}" not found`);
          process.exit(1);
        }
        displayModelInfo(model);
      } else if (options.json) {
        console.log(JSON.stringify(models, null, 2));
      } else {
        // Default table view
        console.log(`\nFound ${models.length} models\n`);
        const table = new Table({
          head: ['ID', 'Provider', 'Context', 'Input Cost/1M', 'Output Cost/1M', 'Added'],
          style: {
            head: [],
            border: []
          }
        });

        models.forEach(model => {
          const inputCost = model.costs?.promptTokens ?? 0;
          const outputCost = model.costs?.completionTokens ?? 0;
          table.push([
            model.name,
            model.provider,
            formatContextLength(model.contextLength),
            inputCost === 0 ? 'Free' : `$${inputCost.toFixed(4)}`,
            outputCost === 0 ? 'Free' : `$${outputCost.toFixed(4)}`,
            formatDate(model.addedDate)
          ]);
        });

        console.log(table.toString());
        console.log('\nTip: Use --json for machine-readable output');
        console.log('     Use --view info --id <model-id> for detailed information about a specific model');
        console.log('     Use --provider <provider> to filter by specific provider');
      }
    } catch (error) {
      console.error('Error fetching models:', error);
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

      // Calculate total cost for 1M tokens (both prompt and completion)
      const modelsWithTotalCost = models.map(model => ({
        ...model,
        totalCostPer1M: model.costs ? 
          (model.costs.promptTokens + model.costs.completionTokens) : 0
      }));

      // Sort models
      modelsWithTotalCost.sort((a, b) => {
        const aCost = a.costs ? a.costs.promptTokens + a.costs.completionTokens : 0;
        const bCost = b.costs ? b.costs.promptTokens + b.costs.completionTokens : 0;
        
        switch (options.sortBy) {
          case 'prompt':
            return (a.costs?.promptTokens || 0) - (b.costs?.promptTokens || 0);
          case 'completion':
            return (a.costs?.completionTokens || 0) - (b.costs?.completionTokens || 0);
          default:
            return aCost - bCost;
        }
      });

      printHeader('Model Costs (per 1M tokens)');
      console.log(
        chalk.bold(chalk.cyan('Model'.padEnd(35))),
        chalk.bold(chalk.blue('Provider'.padEnd(12))),
        chalk.bold(chalk.yellow('Prompt'.padEnd(12))),
        chalk.bold(chalk.yellow('Completion'.padEnd(12))),
        chalk.bold(chalk.yellow('Total'))
      );
      console.log(chalk.dim('─'.repeat(85)));

      modelsWithTotalCost.forEach(model => {
        const inputCost = model.costs?.promptTokens || 0;
        const outputCost = model.costs?.completionTokens || 0;
        const totalCost = inputCost + outputCost;
        
        console.log(
          chalk.cyan(model.name.padEnd(35)),
          chalk.blue(model.provider.padEnd(12)),
          inputCost === 0 ? 'Free'.padEnd(12) : `$${inputCost.toFixed(4)}`.padEnd(12),
          outputCost === 0 ? 'Free'.padEnd(12) : `$${outputCost.toFixed(4)}`.padEnd(12),
          totalCost === 0 ? chalk.green('Free') : chalk.bold(`$${totalCost.toFixed(4)}`)
        );
      });
    } catch (error) {
      console.error('Error fetching model costs:', error);
      process.exit(1);
    }
  });