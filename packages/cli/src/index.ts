#!/usr/bin/env node
import { Command } from 'commander';
import { modelsCommand } from './commands/models.js';
import { evaluateCommand } from './commands/evaluate.js';
import { evalsCommand } from './commands/evals.js';

const program = new Command();

program
  .name('model-eval')
  .description('CLI tool for evaluating language models')
  .version('0.0.1');

// Add commands
program.addCommand(modelsCommand);
program.addCommand(evaluateCommand);
program.addCommand(evalsCommand);

program.parse(); 