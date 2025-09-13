import { Command } from 'commander';

export function addCommonOptions(cmd: Command): Command {
  return cmd
    .requiredOption('-p, --provider <provider>', 'Provider of the model')
    .requiredOption('-m, --model <model>', 'Model to use')
    .option('--attach <filePath>', 'File to attach to the prompt or conversation (any file type)')
    .option('--debug', 'Enable debug logging')
    .option('--system-prompt <prompt>', 'Custom system prompt for the conversation')
    .option('--object', 'Expect a structured object response (use streamObject instead of streamText)')
    .option('--stats', 'Show response statistics after completion');
}

export function parseCommonOptions(options: any) {
  return {
    provider: options.provider,
    model: options.model,
    attach: options.attach,
    debug: !!options.debug,
    systemPrompt: options.systemPrompt,
    object: !!options.object,
    stats: !!options.stats,
  };
} 