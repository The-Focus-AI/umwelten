import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { loadAndPreviewCSV, parseEntireCSV, sampleRows, SampleOptions } from './csvSampler.js';
import { detectHeaderAndData } from './headerDetector.js';
import { validateParsingSpec, validateDomainSpec } from './validation.js';
import { deriveProjectNameFromPath, ExitCodes } from './utils.js';
import { generateProject } from './templating/codegen.js';

async function loadCore() {
	const { BaseModelRunner } = await import('umwelten/cognition/runner.js');
	const { Interaction } = await import('umwelten/interaction/interaction.js');
	return { BaseModelRunner, Interaction } as any;
}

export function createAnalyzeCommand(): Command {
	return new Command('analyze')
		.description('Guided REPL to infer specs and generate an MCP server project')
		.argument('<csv>', 'Path to CSV file')
		.option('--project-name <name>')
		.option('--head <n>', 'Head sample rows', (v) => parseInt(v, 10), process.env.WEIRD_HEAD_ROWS ? parseInt(process.env.WEIRD_HEAD_ROWS, 10) : 25)
		.option('--random <n>', 'Random sample rows', (v) => parseInt(v, 10), process.env.WEIRD_RANDOM_ROWS ? parseInt(process.env.WEIRD_RANDOM_ROWS, 10) : 75)
		.option('--seed <n>', 'Random seed', (v) => parseInt(v, 10), process.env.WEIRD_SAMPLE_SEED ? parseInt(process.env.WEIRD_SAMPLE_SEED, 10) : 42)
		.option('--cap <n>', 'Sample cap', (v) => parseInt(v, 10), process.env.WEIRD_SAMPLE_CAP ? parseInt(process.env.WEIRD_SAMPLE_CAP, 10) : 200)
		.option('--model <id>', 'LLM model id', process.env.WEIRD_MODEL || 'gemini-2.5-pro-latest')
		.option('--out <dir>', 'Output directory', '')
		.option('--no-write', 'Dry run; do not generate project')
		.action(async (csv: string, opts) => {
			try {
				const sample: SampleOptions = { head: opts.head, random: opts.random, cap: opts.cap, seed: opts.seed };
				const preview = loadAndPreviewCSV(csv, sample);
				console.log(chalk.cyan('Detected encoding:'), preview.detection.encoding);
				console.log(chalk.cyan('Detected delimiter:'), JSON.stringify(preview.detection.delimiter));

				let detection = await detectHeaderAndData(preview.rows, preview.detection.delimiter, true, opts.model);
				console.log(chalk.cyan('Proposed header row index:'), detection.header_row_index);
				console.log(chalk.cyan('Proposed data start row index:'), detection.data_start_row_index);
				console.log(chalk.cyan('Has header?'), detection.has_header);

				const confHeader = await prompts([
					{ type: 'number', name: 'header', message: 'Confirm header_row_index', initial: detection.header_row_index },
					{ type: 'number', name: 'dataStart', message: 'Confirm data_start_row_index', initial: detection.data_start_row_index },
					{ type: 'confirm', name: 'hasHeader', message: 'Has header?', initial: detection.has_header },
				]);
				detection.header_row_index = confHeader.header;
				detection.data_start_row_index = confHeader.dataStart;
				detection.has_header = confHeader.hasHeader;

				const allRows = parseEntireCSV(csv, preview.detection);
				const sampled = sampleRows(allRows, sample);

				const { BaseModelRunner, Interaction } = await loadCore();
				const runner = new BaseModelRunner();
				const parsingInteraction = new Interaction({ name: opts.model, provider: 'google' }, 'Output only valid JSON matching the ParsingSpec schema. No prose.');
				parsingInteraction.addMessage({ role: 'user', content: buildParsingSpecPrompt(preview.detection.encoding, preview.detection.delimiter, detection, sampled) });
				const parsingRes = await runner.generateText(parsingInteraction);
				const parsingSpec = validateParsingSpec(safeParseJSON(parsingRes.content || '') || {});
				console.log(chalk.green('ParsingSpec proposed by LLM:'));
				console.log(JSON.stringify(parsingSpec, null, 2));

				const parsingEdited = await prompts({ type: 'confirm', name: 'ok', message: 'Accept ParsingSpec?', initial: true });
				if (!parsingEdited.ok) {
					const manual = await prompts({ type: 'text', name: 'json', message: 'Paste edited ParsingSpec JSON' });
					try {
						const obj = JSON.parse(manual.json);
						Object.assign(parsingSpec, validateParsingSpec(obj));
					} catch (e: any) {
						console.error(e.message);
						process.exit(2);
					}
				}

				const domainInteraction = new Interaction({ name: opts.model, provider: 'google' }, 'Output only valid JSON matching the DomainSpec schema. No prose.');
				domainInteraction.addMessage({ role: 'user', content: buildDomainSpecPrompt(parsingSpec, sampled) });
				const domainRes = await runner.generateText(domainInteraction);
				const domainSpec = validateDomainSpec(safeParseJSON(domainRes.content || '') || {});
				console.log(chalk.green('DomainSpec proposed by LLM:'));
				console.log(JSON.stringify(domainSpec, null, 2));
				const domainEdited = await prompts({ type: 'confirm', name: 'ok', message: 'Accept DomainSpec?', initial: true });
				if (!domainEdited.ok) {
					const manual = await prompts({ type: 'text', name: 'json', message: 'Paste edited DomainSpec JSON' });
					try {
						const obj = JSON.parse(manual.json);
						Object.assign(domainSpec, validateDomainSpec(obj));
					} catch (e: any) {
						console.error(e.message);
						process.exit(2);
					}
				}

				if (opts.write === false) {
					console.log(chalk.yellow('Dry run complete. No files written.'));
					return;
				}

				const projectName = opts.projectName || deriveProjectNameFromPath(csv);
				const outDir = opts.out || path.resolve(process.cwd(), 'generated', `mcp-${projectName}`);
				await generateProject({ outDir, projectName, parsingSpec, domainSpec });
				console.log(chalk.green('Project generated at:'), outDir);
				console.log('Next steps:');
				console.log(`  cd ${outDir}`);
				console.log('  pnpm install');
				console.log('  pnpm start');
			} catch (e: any) {
				console.error(e.message || e);
				process.exit(typeof e.code === 'number' ? e.code : ExitCodes.LLM_SPEC_FAILURE);
			}
		});
}

function buildParsingSpecPrompt(encoding: string, delimiter: string, detection: { header_row_index: number; data_start_row_index: number; has_header: boolean }, rows: string[][]): string {
	return [
		`Detected encoding: ${encoding}`,
		`Detected delimiter: ${JSON.stringify(delimiter)}`,
		`Confirmed indices: header_row_index=${detection.header_row_index}, data_start_row_index=${detection.data_start_row_index}, has_header=${detection.has_header}`,
		'Allowed types: "string"|"integer"|"float"|"boolean"|"date"|"datetime"|"json". Map to SQLite: string/json->TEXT, integer->INTEGER, float->REAL, boolean->INTEGER, date/datetime->TEXT (ISO).',
		'Sampled rows (CSV):',
		rows.map(r => r.join(delimiter)).join('\n'),
		'Respond with strict JSON matching ParsingSpec schema only.'
	].join('\n');
}

function buildDomainSpecPrompt(parsingSpec: any, rows: string[][]): string {
	return [
		'Given this ParsingSpec JSON:',
		JSON.stringify(parsingSpec),
		'and these sampled rows (CSV):',
		rows.map(r => r.join(',')).join('\n'),
		'Respond with strict JSON matching DomainSpec schema only. Keep faq_queries small (2–5).'
	].join('\n');
}

function safeParseJSON(text: string): any | null {
	try { return JSON.parse(text as any); } catch { const m = (text || '').toString().match(/\{[\s\S]*\}/); return m ? safeParseJSON(m[0]) : null; }
}