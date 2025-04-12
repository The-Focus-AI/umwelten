import { Command } from 'commander';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

const DEFAULT_OUTPUT_DIR = 'output/evaluations';

export const evaluateViewCommand = new Command('evaluate-view')
  .description('View evaluation results from the output directory')
  .option('-f, --file <filename>', 'Filename of the evaluation to view')
  .action((options) => {
    try {
      const files = readdirSync(DEFAULT_OUTPUT_DIR);

      if (files.length === 0) {
        console.log(chalk.yellow('No evaluation results found.'));
        return;
      }

      if (options.file) {
        const filePath = resolve(DEFAULT_OUTPUT_DIR, options.file);
        const content = readFileSync(filePath, 'utf-8');
        console.log(chalk.green(`\nContents of ${options.file}:\n`));
        console.log(content);
      } else {
        console.log(chalk.blue('\nAvailable evaluation results:\n'));
        files.forEach(file => console.log(file));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red('Error reading evaluation results:'), error.message);
      } else {
        console.error(chalk.red('An unknown error occurred.'));
      }
    }
  }); 