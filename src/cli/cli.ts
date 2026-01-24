#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { modelsCommand } from './models.js';
import { runCommand } from './run.js';
import { chatCommand } from './chat.js';
import { addToolsCommand } from './tools.js';
import { evalCommand } from './eval.js';

// Get the version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const program = new Command();

program
  .name('umwelten')
  .description('CLI tool for evaluating language models')
  .version(packageJson.version);

// Add commands
program.addCommand(modelsCommand);
program.addCommand(runCommand);
program.addCommand(chatCommand);
program.addCommand(evalCommand);
addToolsCommand(program);

program.parse(); 