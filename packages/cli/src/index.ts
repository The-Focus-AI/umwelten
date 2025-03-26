#!/usr/bin/env node
import { Command } from 'commander';
import { modelsCommand } from './commands/models';

const program = new Command();

program
  .name('model-eval')
  .description('CLI tool for evaluating language models')
  .version('0.0.1');

// Add commands
program.addCommand(modelsCommand);

program.parse(); 