import { Command } from 'commander';
import { runEvaluation, EvaluationConfig, generateReport, listEvaluations, runEvaluationWithProgress, EnhancedEvaluationConfig } from '../evaluation/api.js';
import path from 'path';
import fs from 'fs';
import React from 'react';
import { render } from 'ink';
import { EvaluationApp } from '../ui/EvaluationApp.js';



function parseModels(modelsString: string): string[] {
  if (!modelsString || modelsString.trim() === '') {
    throw new Error('Models string cannot be empty');
  }

  const models = modelsString.split(',')
    .map(m => m.trim())
    .filter(Boolean);

  if (models.length === 0) {
    throw new Error('No valid models found after parsing');
  }

  // Validate model format: should be "provider:model"
  for (const model of models) {
    if (!model.includes(':')) {
      throw new Error(`Invalid model format "${model}". Expected format: "provider:model"`);
    }
    
    const [provider, ...modelParts] = model.split(':');
    const modelName = modelParts.join(':');
    
    if (!provider || !modelName) {
      throw new Error(`Invalid model format "${model}". Both provider and model name are required`);
    }
  }

  return models;
}

function parseAttachments(attachString: string | undefined): string[] | undefined {
  if (!attachString || attachString.trim() === '') return undefined;
  
  const paths = attachString.split(',')
    .map(p => p.trim())
    .filter(Boolean);
  
  if (paths.length === 0) return undefined;

  const resolved: string[] = [];
  
  for (const p of paths) {
    if (p === '') continue;
    
    const resolvedPath = path.resolve(p);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Attachment file not found: "${p}" (resolved to: ${resolvedPath})`);
    }
    
    // Check if it's actually a file, not a directory
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Attachment path is not a file: "${p}" (resolved to: ${resolvedPath})`);
    }
    
    resolved.push(resolvedPath);
  }
  
  return resolved.length > 0 ? resolved : undefined;
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
  .option('--concurrent', 'Enable concurrent evaluation for faster processing', false)
  .option('--max-concurrency <number>', 'Maximum number of concurrent evaluations (default: 3)', parseInt)
  .option('--schema <dsl>', 'Simple DSL schema format (e.g., "name, age int, active bool")')
  .option('--schema-template <name>', 'Built-in schema template (person, contact, event)')
  .option('--schema-file <path>', 'JSON Schema file path')
  .option('--zod-schema <path>', 'TypeScript Zod schema file path')
  .option('--validate-output', 'Enable output validation (default: true with schemas)', true)
  .option('--coerce-types', 'Attempt to coerce data types (string numbers → numbers)', false)
  .option('--strict-validation', 'Fail evaluation on validation errors', false)
  .action(async (options) => {
    try {
      // Validate required options - these should already be validated by Commander.js
      // but adding defensive checks for better error messages
      if (!options.prompt || options.prompt.trim() === '') {
        console.error('❌ Error: Prompt cannot be empty');
        console.error('   Use --prompt "Your evaluation prompt here"');
        process.exit(1);
      }
      
      if (!options.models || options.models.trim() === '') {
        console.error('❌ Error: Models list cannot be empty');
        console.error('   Use --models "provider1:model1,provider2:model2"');
        console.error('   Example: --models "openai:gpt-4,anthropic:claude-3-sonnet"');
        process.exit(1);
      }
      
      if (!options.id || options.id.trim() === '') {
        console.error('❌ Error: Evaluation ID cannot be empty');
        console.error('   Use --id "my-evaluation-name"');
        process.exit(1);
      }

      // Validate evaluation ID format
      const idRegex = /^[a-zA-Z0-9_-]+$/;
      if (!idRegex.test(options.id)) {
        console.error('❌ Error: Invalid evaluation ID format');
        console.error('   ID can only contain letters, numbers, hyphens, and underscores');
        console.error(`   Invalid ID: "${options.id}"`);
        process.exit(1);
      }

      // Check for existing evaluation if not resuming
      const evaluationDir = path.join(process.cwd(), "output", "evaluations", options.id);
      if (fs.existsSync(evaluationDir) && !options.resume) {
        console.error('❌ Error: Evaluation ID already exists');
        console.error(`   Directory: ${evaluationDir}`);
        console.error('   Use --resume to continue existing evaluation or choose a different ID');
        process.exit(1);
      }

      // Validate temperature range
      if (options.temperature !== undefined) {
        const temp = parseFloat(options.temperature);
        if (isNaN(temp) || temp < 0 || temp > 2) {
          console.error('❌ Error: Invalid temperature value');
          console.error('   Temperature must be a number between 0 and 2');
          console.error(`   Provided: ${options.temperature}`);
          process.exit(1);
        }
      }

      // Validate timeout
      if (options.timeout !== undefined) {
        const timeout = parseInt(options.timeout);
        if (isNaN(timeout) || timeout < 1000) {
          console.error('❌ Error: Invalid timeout value');
          console.error('   Timeout must be at least 1000ms (1 second)');
          console.error(`   Provided: ${options.timeout}`);
          process.exit(1);
        }
      }

      // Validate max concurrency
      if (options.maxConcurrency !== undefined) {
        const maxConcurrency = parseInt(options.maxConcurrency);
        if (isNaN(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 20) {
          console.error('❌ Error: Invalid max concurrency value');
          console.error('   Max concurrency must be between 1 and 20');
          console.error(`   Provided: ${options.maxConcurrency}`);
          process.exit(1);
        }
      }

      // Parse models with better error handling
      let models: string[];
      try {
        models = parseModels(options.models);
        console.log(`🤖 Parsed ${models.length} models: ${models.join(', ')}`);
      } catch (error) {
        console.error('❌ Error parsing models:', error instanceof Error ? error.message : error);
        console.error('   Expected format: "provider1:model1,provider2:model2"');
        console.error('   Example: "openai:gpt-4,anthropic:claude-3-sonnet"');
        process.exit(1);
      }

      // Parse attachments with better error handling
      let attachments: string[] | undefined;
      try {
        attachments = parseAttachments(options.attach);
        if (attachments) {
          console.log(`📎 Found ${attachments.length} attachments`);
        }
      } catch (error) {
        console.error('❌ Error parsing attachments:', error instanceof Error ? error.message : error);
        console.error('   Make sure all attachment files exist and are readable');
        process.exit(1);
      }

      // Process schema validation options
      let schemaConfig: any = undefined;
      if (options.schema || options.schemaTemplate || options.schemaFile || options.zodSchema) {
        console.log('🔍 Schema validation enabled');
        
        // Validate that only one schema option is provided
        const schemaOptions = [options.schema, options.schemaTemplate, options.schemaFile, options.zodSchema].filter(Boolean);
        if (schemaOptions.length > 1) {
          console.error('❌ Error: Multiple schema options provided');
          console.error('   Use only one of: --schema, --schema-template, --schema-file, or --zod-schema');
          process.exit(1);
        }

        if (options.schema) {
          schemaConfig = { type: 'dsl', value: options.schema };
          console.log(`   DSL Schema: ${options.schema}`);
        } else if (options.schemaTemplate) {
          schemaConfig = { type: 'template', value: options.schemaTemplate };
          console.log(`   Template: ${options.schemaTemplate}`);
        } else if (options.schemaFile) {
          const schemaPath = path.resolve(options.schemaFile);
          if (!fs.existsSync(schemaPath)) {
            console.error(`❌ Error: Schema file not found: ${options.schemaFile}`);
            console.error(`   Resolved path: ${schemaPath}`);
            process.exit(1);
          }
          schemaConfig = { type: 'file', value: schemaPath };
          console.log(`   Schema File: ${options.schemaFile}`);
        } else if (options.zodSchema) {
          const zodPath = path.resolve(options.zodSchema);
          if (!fs.existsSync(zodPath)) {
            console.error(`❌ Error: Zod schema file not found: ${options.zodSchema}`);
            console.error(`   Resolved path: ${zodPath}`);
            process.exit(1);
          }
          schemaConfig = { type: 'zod', value: zodPath };
          console.log(`   Zod Schema: ${options.zodSchema}`);
        }

        // Add validation options
        schemaConfig.validateOutput = options.validateOutput;
        schemaConfig.coerceTypes = options.coerceTypes;
        schemaConfig.strictValidation = options.strictValidation;
        
        console.log(`   Validation: ${schemaConfig.validateOutput ? 'enabled' : 'disabled'}`);
        console.log(`   Type Coercion: ${schemaConfig.coerceTypes ? 'enabled' : 'disabled'}`);
        console.log(`   Strict Mode: ${schemaConfig.strictValidation ? 'enabled' : 'disabled'}`);
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
        attachments,
        concurrent: options.concurrent,
        maxConcurrency: options.maxConcurrency || 3,
        schema: schemaConfig
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
              console.error('\n❌ Interactive evaluation failed:', error.message);
              if (error.stack) {
                console.error('Stack trace:', error.stack);
              }
              process.exit(1);
            }
          })
        );

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
          console.log('\n⏸️  Evaluation interrupted by user');
          app.unmount();
          process.exit(0);
        });

        // Handle uncaught exceptions during UI mode
        process.on('uncaughtException', (error) => {
          console.error('\n💥 Uncaught exception during interactive evaluation:', error.message);
          app.unmount();
          process.exit(1);
        });

        return; // Don't run the regular evaluation
      }

      // Run evaluation (regular mode)
      console.log('🚀 Starting evaluation...\n');
      console.log(`   ID: ${config.evaluationId}`);
      console.log(`   Models: ${models.length}`);
      if (attachments) console.log(`   Attachments: ${attachments.length}`);
      if (config.concurrent) {
        console.log(`   Mode: Concurrent (max: ${config.maxConcurrency})`);
      } else {
        console.log(`   Mode: Sequential`);
      }
      console.log('');

      const result = await runEvaluation(config);
      
      // Summary output
      console.log('\n📊 Evaluation Summary:');
      console.log(`   ID: ${result.evaluationId}`);
      console.log(`   Output: ${result.outputDir}`);
      console.log(`   Total Models: ${result.results.length}`);
      console.log(`   Successful: ${result.results.filter(r => r.success).length}`);
      console.log(`   Failed: ${result.results.filter(r => !r.success).length}`);
      
      // Show any errors with more detail
      const failed = result.results.filter(r => !r.success);
      if (failed.length > 0) {
        console.log('\n❌ Failed evaluations:');
        failed.forEach((f, index) => {
          console.log(`   ${index + 1}. ${f.model.provider}:${f.model.name}`);
          console.log(`      Error: ${f.error}`);
        });
        console.log('\n💡 Tip: Use --resume to retry failed evaluations');
      }

      console.log(`\n✅ Evaluation completed! Check results in: ${result.outputDir}`);
      
    } catch (error) {
      console.error('\n❌ Evaluation failed:');
      
      if (error instanceof Error) {
        console.error(`   ${error.message}`);
        
        // Provide helpful suggestions based on error type
        if (error.message.includes('ENOENT')) {
          console.error('\n💡 This looks like a file not found error. Check:');
          console.error('   - All attachment files exist');
          console.error('   - File paths are correct');
        } else if (error.message.includes('EACCES')) {
          console.error('\n💡 This looks like a permission error. Check:');
          console.error('   - File permissions');
          console.error('   - Directory write permissions');
        } else if (error.message.includes('timeout')) {
          console.error('\n💡 This looks like a timeout error. Try:');
          console.error('   - Increasing timeout with --timeout <ms>');
          console.error('   - Using simpler prompts');
        } else if (error.message.includes('Invalid model format')) {
          console.error('\n💡 Model format error. Examples of correct formats:');
          console.error('   - "openai:gpt-4"');
          console.error('   - "anthropic:claude-3-sonnet"');
          console.error('   - "ollama:llama2"');
        }
        
        // Show stack trace in debug mode (if NODE_ENV is development)
        if (process.env.NODE_ENV === 'development' && error.stack) {
          console.error('\n🐛 Debug stack trace:');
          console.error(error.stack);
        }
      } else {
        console.error(`   ${String(error)}`);
      }
      
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
      // Validate evaluation ID
      if (!options.id || options.id.trim() === '') {
        console.error('❌ Error: Evaluation ID cannot be empty');
        console.error('   Use --id "your-evaluation-id"');
        process.exit(1);
      }

      // Validate format
      const validFormats = ['markdown', 'html', 'json', 'csv'];
      if (!validFormats.includes(options.format)) {
        console.error(`❌ Error: Invalid format '${options.format}'`);
        console.error(`   Valid formats: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      // Check if evaluation exists
      const evaluationDir = path.join(process.cwd(), "output", "evaluations", options.id);
      if (!fs.existsSync(evaluationDir)) {
        console.error(`❌ Error: Evaluation not found: ${options.id}`);
        console.error(`   Expected directory: ${evaluationDir}`);
        console.error('   Use "umwelten eval list" to see available evaluations');
        process.exit(1);
      }

      // Check if output directory exists and is writable (if output file specified)
      if (options.output) {
        const outputPath = path.resolve(options.output);
        const outputDir = path.dirname(outputPath);
        
        if (!fs.existsSync(outputDir)) {
          console.error(`❌ Error: Output directory does not exist: ${outputDir}`);
          process.exit(1);
        }

        // Check if file already exists and warn user
        if (fs.existsSync(outputPath)) {
          console.log(`⚠️  Warning: Output file already exists and will be overwritten: ${outputPath}`);
        }
      }

      console.log(`📊 Generating ${options.format} report for evaluation: ${options.id}`);
      
      // Generate report
      const report = await generateReport(options.id, options.format);
      
      // Output to file or stdout
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, report, 'utf8');
        console.log(`✅ Report saved to: ${outputPath}`);
        
        // Show file size
        const stats = fs.statSync(outputPath);
        console.log(`   File size: ${(stats.size / 1024).toFixed(1)}KB`);
      } else {
        // Output to stdout
        console.log('\n' + '='.repeat(60));
        console.log(report);
        console.log('='.repeat(60));
      }

    } catch (error) {
      console.error('\n❌ Report generation failed:');
      
      if (error instanceof Error) {
        console.error(`   ${error.message}`);
        
        // Provide helpful suggestions based on error type
        if (error.message.includes('No evaluation results found')) {
          console.error('\n💡 This evaluation has no results. Try:');
          console.error('   - Running the evaluation first with "umwelten eval run"');
          console.error('   - Checking if the evaluation ID is correct');
        } else if (error.message.includes('No valid responses found')) {
          console.error('\n💡 No valid responses found. This could mean:');
          console.error('   - All evaluations failed');
          console.error('   - Response files are corrupted');
          console.error('   - Evaluation was interrupted');
        } else if (error.message.includes('EACCES')) {
          console.error('\n💡 Permission error. Check:');
          console.error('   - Write permissions for output directory');
          console.error('   - File ownership');
        }
        
        if (process.env.NODE_ENV === 'development' && error.stack) {
          console.error('\n🐛 Debug stack trace:');
          console.error(error.stack);
        }
      } else {
        console.error(`   ${String(error)}`);
      }
      
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

// Schema parsing utility
function parseSchemaOptions(options: any) {
  let schemaConfig: any = undefined;
  
  // Validate schema options
  const schemaOptions = [options.schema, options.schemaTemplate, options.schemaFile, options.zodSchema].filter(Boolean);
  if (schemaOptions.length > 1) {
    console.error('❌ Error: Multiple schema options specified');
    console.error('   Use only one of: --schema, --schema-template, --schema-file, or --zod-schema');
    process.exit(1);
  }

  if (options.schema) {
    schemaConfig = { type: 'dsl', value: options.schema };
  } else if (options.schemaTemplate) {
    schemaConfig = { type: 'template', value: options.schemaTemplate };
  } else if (options.schemaFile) {
    const schemaPath = path.resolve(options.schemaFile);
    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Error: Schema file not found: ${options.schemaFile}`);
      console.error(`   Resolved path: ${schemaPath}`);
      process.exit(1);
    }
    schemaConfig = { type: 'file', value: schemaPath };
  } else if (options.zodSchema) {
    const zodPath = path.resolve(options.zodSchema);
    if (!fs.existsSync(zodPath)) {
      console.error(`❌ Error: Zod schema file not found: ${options.zodSchema}`);
      console.error(`   Resolved path: ${zodPath}`);
      process.exit(1);
    }
    schemaConfig = { type: 'zod', value: zodPath };
  }

  // Add validation options
  if (schemaConfig) {
    schemaConfig.validateOutput = options.validateOutput;
    schemaConfig.coerceTypes = options.coerceTypes;
    schemaConfig.strictValidation = options.strictValidation;
  }

  return schemaConfig;
}

// File discovery utility for batch processing
function discoverFiles(files?: string[], directory?: string, filePattern?: string, recursive?: boolean, maxFiles?: number): string[] {
  const discoveredFiles: string[] = [];
  
  // Process explicit file list
  if (files && files.length > 0) {
    for (const file of files) {
      const resolvedPath = path.resolve(file);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        discoveredFiles.push(resolvedPath);
      }
    }
  }
  
  // Process directory scanning
  if (directory) {
    const dirPath = path.resolve(directory);
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${directory}`);
    }
    
    function scanDirectory(dir: string, depth: number = 0): void {
      if (maxFiles && discoveredFiles.length >= maxFiles) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (maxFiles && discoveredFiles.length >= maxFiles) break;
        
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory() && recursive && depth < 10) { // Prevent infinite recursion
          scanDirectory(itemPath, depth + 1);
        } else if (stats.isFile()) {
          // Check file pattern if specified
          if (!filePattern || item.match(new RegExp(filePattern.replace(/\*/g, '.*')))) {
            discoveredFiles.push(itemPath);
          }
        }
      }
    }
    
    scanDirectory(dirPath);
  }
  
  return discoveredFiles.slice(0, maxFiles || discoveredFiles.length);
}

const evalBatchCommand = new Command('batch')
  .description('Run evaluations across multiple files')
  .requiredOption('-p, --prompt <prompt>', 'The prompt to evaluate')
  .requiredOption('-m, --models <models>', 'Comma-separated list of models in format "provider:model"')
  .requiredOption('-i, --id <id>', 'Unique evaluation identifier')
  .option('-s, --system <prompt>', 'System prompt (optional)')
  .option('-t, --temperature <number>', 'Temperature for model generation', parseFloat)
  .option('--timeout <ms>', 'Timeout in milliseconds', parseInt)
  .option('--resume', 'Resume evaluation (re-run existing responses)', false)
  .option('--ui', 'Use interactive UI with streaming responses', false)
  .option('--concurrent', 'Enable concurrent evaluation for faster processing', false)
  .option('--max-concurrency <number>', 'Maximum number of concurrent evaluations (default: 3)', parseInt)
  .option('--files <files>', 'Comma-separated list of files or glob patterns')
  .option('--directory <dir>', 'Directory to scan for files')
  .option('--file-pattern <pattern>', 'File pattern (e.g., "*.jpg")')
  .option('--recursive', 'Scan subdirectories recursively', false)
  .option('--max-files <number>', 'Maximum number of files to process', parseInt)
  .option('--schema <dsl>', 'Simple DSL schema format (e.g., "name, age int, active bool")')
  .option('--schema-template <name>', 'Built-in schema template (person, contact, event)')
  .option('--schema-file <path>', 'JSON Schema file path')
  .option('--zod-schema <path>', 'TypeScript Zod schema file path')
  .option('--validate-output', 'Enable output validation (default: true with schemas)', true)
  .option('--coerce-types', 'Attempt to coerce data types (string numbers → numbers)', false)
  .option('--strict-validation', 'Fail evaluation on validation errors', false)
  .action(async (options) => {
    try {
      // Validate required options
      if (!options.prompt || options.prompt.trim() === '') {
        console.error('❌ Error: Prompt cannot be empty');
        console.error('   Use --prompt "Your evaluation prompt here"');
        process.exit(1);
      }
      
      if (!options.models || options.models.trim() === '') {
        console.error('❌ Error: Models cannot be empty');
        console.error('   Use --models "provider:model1,provider:model2"');
        process.exit(1);
      }
      
      if (!options.id || options.id.trim() === '') {
        console.error('❌ Error: Evaluation ID cannot be empty');
        console.error('   Use --id "unique-evaluation-id"');
        process.exit(1);
      }
      
      // Validate batch-specific options
      if (!options.files && !options.directory) {
        console.error('❌ Error: Must specify either --files or --directory for batch processing');
        console.error('   Use --files "file1.jpg,file2.jpg" or --directory "input/images"');
        process.exit(1);
      }
      
      // Parse models
      const models = parseModels(options.models);
      
             // Discover files
       const fileList = options.files ? options.files.split(',').map((f: string) => f.trim()) : undefined;
       const files = discoverFiles(fileList, options.directory, options.filePattern, options.recursive, options.maxFiles);
      
      if (files.length === 0) {
        console.error('❌ Error: No files found for batch processing');
        if (options.directory) {
          console.error(`   Directory: ${options.directory}`);
          console.error(`   Pattern: ${options.filePattern || '*'}`);
          console.error(`   Recursive: ${options.recursive ? 'Yes' : 'No'}`);
        }
        process.exit(1);
      }
      
      console.log(`🚀 Starting batch evaluation with ${files.length} files`);
      console.log(`📁 Files: ${files.length} files discovered`);
      console.log(`🤖 Models: ${models.length} models (${models.join(', ')})`);
      console.log(`🔄 Total evaluations: ${files.length * models.length}`);
      console.log();
      
      // Parse schema options
      const schema = parseSchemaOptions(options);
      
             // Create base configuration
       const baseConfig: EvaluationConfig = {
         evaluationId: options.id,
         prompt: options.prompt,
         models: models,
         systemPrompt: options.system,
         temperature: options.temperature,
         timeout: options.timeout,
         resume: options.resume,
         concurrent: options.concurrent || false,
         maxConcurrency: options.maxConcurrency || 3,
         schema: schema
       };
       
       // Run batch evaluation
       console.log('📊 Running batch evaluation...');
       
       let completed = 0;
       const total = files.length * models.length;
       
       for (const file of files) {
         const fileConfig = { ...baseConfig, attachments: [file] };
         
         try {
           console.log(`\n📄 Processing: ${path.basename(file)}`);
           const result = await runEvaluation(fileConfig);
           
           completed += result.results.filter(r => r.success).length;
           console.log(`\n✅ Completed: ${path.basename(file)}`);
         } catch (error) {
           console.error(`\n❌ Failed: ${path.basename(file)}`);
           if (error instanceof Error) {
             console.error(`   Error: ${error.message}`);
           }
         }
       }
       
       console.log(`\n🎉 Batch evaluation complete!`);
       console.log(`   ✅ Successful: ${completed}/${total} evaluations`);
       console.log(`   📊 Results saved to: output/evaluations/${options.id}/`);
       console.log(`   📋 Generate report: umwelten eval report --id ${options.id}`);
      
    } catch (error) {
      console.error('\n❌ Batch evaluation failed:');
      
      if (error instanceof Error) {
        console.error(`   ${error.message}`);
        
        if (error.message.includes('No files found')) {
          console.error('\n💡 No files found. Check:');
          console.error('   - File paths are correct');
          console.error('   - Directory exists and contains files');
          console.error('   - File pattern matches your files');
        } else if (error.message.includes('Invalid model format')) {
          console.error('\n💡 Invalid model format. Use:');
          console.error('   --models "provider:model" (e.g., "google:gemini-2.0-flash")');
        }
        
        if (process.env.NODE_ENV === 'development' && error.stack) {
          console.error('\n🐛 Debug stack trace:');
          console.error(error.stack);
        }
      } else {
        console.error(`   ${String(error)}`);
      }
      
      process.exit(1);
    }
  });

export const evalCommand = new Command('eval')
  .description('Evaluation commands')
  .addCommand(evalRunCommand)
  .addCommand(evalReportCommand)
  .addCommand(evalListCommand)
  .addCommand(evalBatchCommand);