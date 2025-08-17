#!/usr/bin/env node
import { Command } from 'commander';
import { createPreviewCommand } from './preview.js';
import { createAnalyzeCommand } from './repl.js';
import { createDoctorCommand } from './doctor.js';

const program = new Command();

program
	.name('weird')
	.description('Convert “weird” CSVs into a runnable TypeScript MCP server')
	.version('0.1.0');

program.addCommand(createPreviewCommand());
program.addCommand(createAnalyzeCommand());
program.addCommand(createDoctorCommand());

program.parseAsync().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});