import { Command } from 'commander';
import { Stimulus } from '@umwelten/core/stimulus/stimulus.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import { EvaluationCache } from '@umwelten/evaluation/evaluation/caching/cache-service.js';
import {
  SimpleEvaluation,
  type EvaluationResult,
} from '@umwelten/evaluation/evaluation/strategies/simple-evaluation.js';

export function parseEvaluationModels(value: string): ModelDetails[] {
  return value.split(',').map((entry) => {
    const ref = entry.trim();
    const separator = ref.indexOf(':');
    if (separator <= 0 || separator === ref.length - 1) {
      throw new Error(`Invalid model "${ref}". Expected provider:model.`);
    }
    return {
      provider: ref.slice(0, separator),
      name: ref.slice(separator + 1),
    };
  });
}

interface EvalRunOptions {
  prompt: string;
  models: string;
  id: string;
  concurrent?: boolean;
  maxConcurrency: string;
  system?: string;
  temperature?: string;
  fresh?: boolean;
  json?: boolean;
}

function printResults(results: EvaluationResult[]): void {
  for (const result of results) {
    const label = `${result.model.provider}:${result.model.name}`;
    console.log(`\n## ${label}`);
    if (result.metadata.error) {
      console.log(`Error: ${result.metadata.error}`);
      continue;
    }
    console.log(result.response.content || '[No response]');
    const cost = result.response.metadata.cost?.totalCost;
    console.log(
      `\n${result.metadata.duration}ms${cost == null ? '' : ` · $${cost.toFixed(6)}`}`,
    );
  }
}

async function runComparison(options: EvalRunOptions): Promise<void> {
  const models = parseEvaluationModels(options.models);
  const maxConcurrency = Number.parseInt(options.maxConcurrency, 10);
  const temperature = options.temperature == null
    ? undefined
    : Number.parseFloat(options.temperature);

  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('--max-concurrency must be a positive integer.');
  }
  if (temperature != null && !Number.isFinite(temperature)) {
    throw new Error('--temperature must be a number.');
  }

  const stimulus = new Stimulus({
    role: 'helpful AI assistant',
    objective: 'respond accurately to the evaluation prompt',
    systemContext: options.system,
    temperature,
  });
  const evaluation = new SimpleEvaluation(
    stimulus,
    models,
    options.prompt,
    new EvaluationCache(options.id),
    {
      evaluationId: options.id,
      useCache: !options.fresh,
      concurrent: options.concurrent,
      maxConcurrency,
      showProgress: false,
    },
  );
  const results = await evaluation.run();

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printResults(results);
  }

  if (results.some((result) => result.metadata.error)) {
    process.exitCode = 1;
  }
}

const evalRunCommand = new Command('run')
  .description('Run one prompt across multiple models with response caching')
  .requiredOption('--prompt <text>', 'prompt to send to every model')
  .requiredOption('--models <provider:model,...>', 'comma-separated model references')
  .requiredOption('--id <name>', 'evaluation/cache identifier')
  .option('--concurrent', 'run models concurrently', false)
  .option('--max-concurrency <number>', 'maximum concurrent model calls', '3')
  .option('--system <text>', 'additional system context')
  .option('--temperature <number>', 'sampling temperature')
  .option('--new', 'ignore cached responses', false)
  .option('--json', 'print machine-readable results', false)
  .action((options) => runComparison({ ...options, fresh: options.new }));

export const evalCommand = new Command('eval')
  .description('Compare and evaluate model responses')
  .addCommand(evalRunCommand);
