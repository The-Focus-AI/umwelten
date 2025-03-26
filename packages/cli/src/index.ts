#!/usr/bin/env node
import { Command } from 'commander';
import { modelsCommand } from './commands/models.js';

const program = new Command();

program
  .name('model-eval')
  .description('Model evaluation CLI')
  .version('0.1.0');

// Add commands
program.addCommand(modelsCommand);

program.parse(); 