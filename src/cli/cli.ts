#!/usr/bin/env node
import { Command } from 'commander';
import { modelsCommand } from './models.js';
import { runCommand } from './run.js';
import { chatCommand } from './chat.js';
import { addToolsCommand } from './tools.js';

const program = new Command();

program
  .name('model-eval')
  .description('CLI tool for evaluating language models')
  .version('0.0.1');

// Add commands
program.addCommand(modelsCommand);
program.addCommand(runCommand);
program.addCommand(chatCommand);
addToolsCommand(program);

program.parse(); 