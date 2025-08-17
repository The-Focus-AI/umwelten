import { Command } from 'commander';
import { execSync } from 'node:child_process';

export function createDoctorCommand(): Command {
	return new Command('doctor')
		.description('Check environment and configuration for weird CLI')
		.action(async () => {
			// Node version
			console.log('Node:', process.version);
			// pnpm presence
			try {
				const out = execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
				console.log('pnpm:', out);
			} catch {
				console.log('pnpm: NOT FOUND');
			}
			// env
			if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
				console.log('GOOGLE_API_KEY: OK');
			} else {
				console.log('GOOGLE_API_KEY: MISSING');
			}
		});
}