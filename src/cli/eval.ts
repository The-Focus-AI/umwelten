import { Command } from 'commander';
import { runEvaluation, EvaluationConfig, generateReport, listEvaluations, runEvaluationWithProgress, EnhancedEvaluationConfig } from '../evaluation/api.js';
import path from 'path';
import fs from 'fs';
import React from 'react';
import { render } from 'ink';
import { EvaluationApp } from '../ui/EvaluationApp.js';

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
  .option('--ui', 'Use interactive UI with streaming responses', false)
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

      if (options.ui) {
        // Use interactive UI
        const enhancedConfig: EnhancedEvaluationConfig = {
          ...config,
          useUI: true
        };

        const app = render(
          React.createElement(EvaluationApp, {
            config: enhancedConfig,
            onComplete: (results: any) => {
              console.log('\n📊 Evaluation Summary:');
              console.log(`   ID: ${results.evaluationId}`);
              console.log(`   Total Time: ${Math.round(results.totalTime / 1000)}s`);
              console.log(`   Models: ${results.results.length}`);
              console.log(`   Successful: ${results.results.filter((r: any) => r.status === 'completed').length}`);
              console.log(`   Failed: ${results.results.filter((r: any) => r.status === 'error').length}`);
              
              const outputDir = path.join(process.cwd(), "output", "evaluations", results.evaluationId);
              console.log(`\n✅ Evaluation completed! Check results in: ${outputDir}`);
              
              process.exit(0);
            },
            onError: (error: Error) => {
              console.error('\n❌ Evaluation failed:', error.message);
              process.exit(1);
            }
          })
        );

        // Handle Ctrl+C
        process.on('SIGINT', () => {
          app.unmount();
          process.exit(0);
        });

        return; // Don't run the regular evaluation
      }

      // Run evaluation (regular mode)
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

const evalListCommand = new Command('list')
  .description('List available evaluations')
  .option('-d, --details', 'Show detailed information including models and reports', false)
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    try {
      const evaluations = listEvaluations(options.details);
      
      if (evaluations.length === 0) {
        console.log('No evaluations found in output/evaluations/');
        console.log('Run "umwelten eval run" to create an evaluation first.');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(evaluations, null, 2));
        return;
      }

      // Format as table
      console.log('📊 Available Evaluations:\n');
      
      if (options.details) {
        for (const evaluation of evaluations) {
          console.log(`🔸 ${evaluation.id}`);
          console.log(`   Models: ${evaluation.responseCount} (${evaluation.modelNames?.join(', ') || 'N/A'})`);
          console.log(`   Last Modified: ${evaluation.lastModified.toLocaleDateString()} ${evaluation.lastModified.toLocaleTimeString()}`);
          console.log(`   Has Reports: ${evaluation.hasReports ? '✅ Yes' : '❌ No'}`);
          console.log(`   Path: ${evaluation.path}`);
          console.log();
        }
      } else {
        // Simple list format
        const maxIdLength = Math.max(...evaluations.map(e => e.id.length));
        
        console.log('ID'.padEnd(maxIdLength + 2) + 'Models  Last Modified');
        console.log('─'.repeat(maxIdLength + 2) + '──────  ─────────────');
        
        for (const evaluation of evaluations) {
          const modelsText = evaluation.responseCount.toString().padStart(6);
          const dateText = evaluation.lastModified.toLocaleDateString();
          console.log(`${evaluation.id.padEnd(maxIdLength + 2)}${modelsText}  ${dateText}`);
        }
      }

      console.log(`\n💡 Use "umwelten eval report --id <ID>" to generate reports`);

    } catch (error) {
      console.error('❌ Failed to list evaluations:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

export const evalCommand = new Command('eval')
  .description('Evaluation commands')
  .addCommand(evalRunCommand)
  .addCommand(evalReportCommand)
  .addCommand(evalListCommand);