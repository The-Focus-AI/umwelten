#!/usr/bin/env node
import { Command } from 'commander';
import { modelsCommand } from './models.js';
import { evaluateCommand } from './evaluate.js';
import { evalsCommand } from './evals.js';
import { runCommand } from './run.js';
import { evaluateViewCommand } from './evaluate-view.js';
import { chatCommand } from './chat.js';

const program = new Command();

program
  .name('model-eval')
  .description('CLI tool for evaluating language models')
  .version('0.0.1');

// Add commands
program.addCommand(modelsCommand);
program.addCommand(evaluateCommand);
program.addCommand(evalsCommand);
program.addCommand(runCommand);
program.addCommand(evaluateViewCommand);
program.addCommand(chatCommand);

program.parse(); 