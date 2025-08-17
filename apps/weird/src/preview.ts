import { Command } from 'commander';
import chalk from 'chalk';
import { loadAndPreviewCSV, SampleOptions } from './csvSampler.js';
import { detectHeaderAndData } from './headerDetector.js';

export function createPreviewCommand(): Command {
	return new Command('preview')
		.description('Show delimiter guess, header/data indices, and first N rows')
		.argument('<csv>', 'Path to CSV file')
		.option('--rows <n>', 'Number of rows to show', (v) => parseInt(v, 10), 20)
		.option('--detect-headers', 'Run header/data detection', false)
		.action(async (csv: string, opts: { rows: number; detectHeaders?: boolean }) => {
			const sample: SampleOptions = { head: 25, random: 75, cap: 200, seed: 42 };
			const preview = loadAndPreviewCSV(csv, sample);
			console.log(chalk.cyan('Encoding:'), preview.detection.encoding);
			console.log(chalk.cyan('Delimiter:'), JSON.stringify(preview.detection.delimiter));

			if (opts.detectHeaders) {
				const detection = await detectHeaderAndData(preview.rows, preview.detection.delimiter, false, '');
				console.log(chalk.cyan('Header row index:'), detection.header_row_index);
				console.log(chalk.cyan('Data start row index:'), detection.data_start_row_index);
				console.log(chalk.cyan('Has header:'), detection.has_header);
			}

			const n = Math.min(opts.rows, preview.rows.length);
			for (let i = 0; i < n; i++) {
				console.log(preview.rows[i].join(preview.detection.delimiter));
			}
		});
}