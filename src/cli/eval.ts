import { Command } from 'commander';
import { runEvaluation, EvaluationConfig, generateReport } from '../evaluation/api.js';
import path from 'path';
import fs from 'fs';

function parseModels(modelsString: string): string[] {
  return modelsString.split(',').map(m => m.trim()).filter(Boolean);
}

function parseAttachments(attachString: string | undefined): string[] | undefined {
  if (!attachString) return undefined;
  return attachString.split(',').map(p => {
    const resolved = path.resolve(p.trim());
    if (!fs.existsSync(resolved)) {
      throw new Error(`Attachment file not found: ${resolved}`);
    }
    return resolved;
  });
}

const evalRunCommand = new Command('run')
  .description('Run an evaluation across multiple models')
  .requiredOption('-p, --prompt <prompt>', 'The prompt to evaluate')
  .requiredOption('-m, --models <models>', 'Comma-separated list of models in format "provider:model"')
  .requiredOption('-i, --id <id>', 'Unique evaluation identifier')
  .option('-s, --system <prompt>', 'System prompt (optional)')
  .option('-t, --temperature <number>', 'Temperature for model generation', parseFloat)
  .option('--timeout <ms>', 'Timeout in milliseconds', parseInt)
  .option('--resume', 'Resume evaluation (re-run existing responses)', false)
  .option('-a, --attach <files>', 'Comma-separated list of file paths to attach')
  .action(async (options) => {
    try {
      // Validate required options
      if (!options.prompt) {
        console.error('Error: --prompt is required');
        process.exit(1);
      }
      
      if (!options.models) {
        console.error('Error: --models is required');
        process.exit(1);
      }
      
      if (!options.id) {
        console.error('Error: --id is required');
        process.exit(1);
      }

      // Parse models
      let models: string[];
      try {
        models = parseModels(options.models);
        if (models.length === 0) {
          throw new Error('No valid models specified');
        }
      } catch (error) {
        console.error('Error parsing models:', error);
        process.exit(1);
      }

      // Parse attachments if provided
      let attachments: string[] | undefined;
      try {
        attachments = parseAttachments(options.attach);
      } catch (error) {
        console.error('Error parsing attachments:', error);
        process.exit(1);
      }

      // Build evaluation config
      const config: EvaluationConfig = {
        evaluationId: options.id,
        prompt: options.prompt,
        models,
        systemPrompt: options.system,
        temperature: options.temperature,
        timeout: options.timeout,
        resume: options.resume,
        attachments
      };

      // Run evaluation
      console.log('🚀 Starting evaluation...\n');
      const result = await runEvaluation(config);
      
      // Summary output
      console.log('\n📊 Evaluation Summary:');
      console.log(`   ID: ${result.evaluationId}`);
      console.log(`   Output: ${result.outputDir}`);
      console.log(`   Models: ${result.results.length}`);
      console.log(`   Successful: ${result.results.filter(r => r.success).length}`);
      console.log(`   Failed: ${result.results.filter(r => !r.success).length}`);
      
      // Show any errors
      const failed = result.results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log('\n❌ Failed evaluations:');
        failed.forEach(f => {
          console.log(`   ${f.model.provider}:${f.model.name} - ${f.error}`);
        });
      }

      console.log(`\n✅ Evaluation completed! Check results in: ${result.outputDir}`);
      
    } catch (error) {
      console.error('❌ Evaluation failed:', error);
      process.exit(1);
    }
  });

const evalReportCommand = new Command('report')
  .description('Generate reports from evaluation results')
  .requiredOption('-i, --id <id>', 'Evaluation ID to generate report for')
  .option('-f, --format <format>', 'Output format: markdown, html, json, csv', 'markdown')
  .option('-o, --output <file>', 'Output file path (defaults to stdout)')
  .action(async (options) => {
    try {
      // Validate format
      const validFormats = ['markdown', 'html', 'json', 'csv'];
      if (!validFormats.includes(options.format)) {
        console.error(`Error: Invalid format '${options.format}'. Valid formats: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      console.log(`📊 Generating ${options.format} report for evaluation: ${options.id}`);
      
      // Generate report
      const report = await generateReport(options.id, options.format);
      
      // Output to file or stdout
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, report, 'utf8');
        console.log(`✅ Report saved to: ${outputPath}`);
      } else {
        // Output to stdout
        console.log('\n' + '='.repeat(60));
        console.log(report);
      }

    } catch (error) {
      console.error('❌ Report generation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

export const evalCommand = new Command('eval')
  .description('Evaluation commands')
  .addCommand(evalRunCommand)
  .addCommand(evalReportCommand);