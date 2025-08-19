#!/usr/bin/env tsx

/**
 * Ollama TypeScript Evaluation Pipeline
 * 
 * This script performs a complete evaluation of Ollama models for TypeScript code generation:
 * 1. Generates responses from multiple Ollama models
 * 2. Extracts TypeScript code from responses
 * 3. Creates Docker environments for each model
 * 4. Tests all Docker containers
 * 5. Generates comprehensive reports
 */

import fs from 'fs';
import path from 'path';
import { FunctionEvaluationRunner } from '../src/evaluation/evaluate.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';
import { extractTypeScriptCode } from '../src/evaluation/typescript-code-extractor.js';
import { DockerEnvironmentGenerator } from '../src/evaluation/docker-generator.js';
import { ReportGenerator } from '../src/evaluation/report-generator.js';

// Configuration
const OLLAMA_MODELS = [
  { name: 'gpt-oss:20b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'deepseek-r1:32b', provider: 'ollama' },
  { name: 'devstral:24b', provider: 'ollama' },
  { name: 'mistral-small3.2:24b', provider: 'ollama' },
  { name: 'llama3.2:latest', provider: 'ollama' }
] as const;

const PROMPT = `i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript`;

const EVALUATION_ID = 'ollama-typescript-eval';
const WORKDIR = path.join(process.cwd(), 'output/evaluations', EVALUATION_ID);

async function main() {
  console.log('🚀 Starting Ollama TypeScript Evaluation Pipeline');
  console.log('='.repeat(60));
  console.log(`📝 Prompt: "${PROMPT}"`);
  console.log(`🤖 Models: ${OLLAMA_MODELS.length} Ollama models`);
  console.log(`📁 Workdir: ${WORKDIR}`);
  console.log();

  // Step 1: Generate responses from all models
  console.log('📤 Step 1: Generating responses from Ollama models...');
  const responses = await generateModelResponses();
  console.log(`✅ Generated ${responses.length} responses`);
  console.log();

  // Step 2: Extract TypeScript code and create Docker environments
  console.log('🔧 Step 2: Extracting TypeScript code and creating Docker environments...');
  const dockerDir = path.join(WORKDIR, 'docker-tests');
  const extractionResults = await extractCodeAndCreateDockerEnvironments(responses, dockerDir);
  console.log(`✅ Created ${extractionResults.length} Docker environments`);
  console.log();

  // Step 3: Test all Docker containers
  console.log('🐳 Step 3: Testing Docker containers...');
  const dockerResults = await testAllDockerContainers(dockerDir);
  console.log(`✅ Tested ${dockerResults.length} Docker containers`);
  console.log();

  // Step 4: Generate comprehensive reports
  console.log('📊 Step 4: Generating reports...');
  await generateReports(responses, dockerDir, dockerResults);
  console.log('✅ Reports generated');
  console.log();

  // Step 5: Print summary
  printSummary(responses, dockerResults);
}

/**
 * Step 1: Generate responses from all models
 */
async function generateModelResponses() {
  const responses: any[] = [];
  const responsesDir = path.join(WORKDIR, 'responses');
  
  // Create responses directory
  if (!fs.existsSync(responsesDir)) {
    fs.mkdirSync(responsesDir, { recursive: true });
  }

  for (const model of OLLAMA_MODELS) {
    console.log(`  🤖 Testing ${model.name}...`);
    
    try {
      // Create evaluation runner with function to generate response
      const runner = new FunctionEvaluationRunner(EVALUATION_ID, 'responses', async (details) => {
        const modelRunner = new BaseModelRunner();
        const interaction = new Interaction(details, 'You are a helpful TypeScript programming assistant.');
        interaction.addMessage({ role: 'user', content: PROMPT });
        
        return await modelRunner.streamText(interaction);
      });

      const response = await runner.evaluate(model);
      
      if (response) {
        responses.push(response);
        console.log(`    ✅ Response generated (${response.content.length} chars)`);
      }
      
    } catch (error) {
      console.error(`    ❌ Error with ${model.name}:`, error);
    }
  }
  
  return responses;
}

/**
 * Step 2: Extract TypeScript code and create Docker environments
 */
async function extractCodeAndCreateDockerEnvironments(responses: any[], dockerDir: string) {
  const results: Array<{ modelName: string; typescriptCode: string }> = [];

  // Create docker directory
  if (!fs.existsSync(dockerDir)) {
    fs.mkdirSync(dockerDir, { recursive: true });
  }

  for (const response of responses) {
    const modelName = response.metadata.model;
    console.log(`  🔍 Processing ${modelName}...`);

    try {
      // Extract TypeScript code
      const typescriptCode = extractTypeScriptCode(response.content);
      
      if (!typescriptCode) {
        console.log(`    ❌ No TypeScript code found for ${modelName}`);
        continue;
      }

      console.log(`    ✅ Extracted ${typescriptCode.length} characters of TypeScript code`);

      // Create Docker environment
      DockerEnvironmentGenerator.generateEnvironment({
        modelName,
        typescriptCode,
        outputDir: dockerDir
      });

      console.log(`    ✅ Created Docker environment for ${modelName}`);
      results.push({ modelName, typescriptCode });

    } catch (error) {
      console.error(`    ❌ Error processing ${modelName}:`, error);
    }
  }

  // Generate master test script
  DockerEnvironmentGenerator.generateMasterTestScript(dockerDir);
  console.log(`    ✅ Generated master test script`);

  return results;
}

/**
 * Step 3: Test all Docker containers
 */
async function testAllDockerContainers(dockerDir: string) {
  const results: Array<{ modelName: string; buildSuccess: boolean; testSuccess: boolean; error?: string; output?: string }> = [];

  // Read all directories
  const dirs = fs.readdirSync(dockerDir).filter(item => {
    const itemPath = path.join(dockerDir, item);
    return fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, 'Dockerfile'));
  });

  for (const dir of dirs) {
    const modelDir = path.join(dockerDir, dir);
    const modelName = dir.replace(/-/g, ':').replace(/_/g, '-');
    
    console.log(`  🐳 Testing ${modelName}...`);

    try {
      const result = await DockerEnvironmentGenerator.testDockerEnvironment(modelDir);
      results.push(result);

      if (result.buildSuccess && result.testSuccess) {
        console.log(`    ✅ ${modelName}: Build and test successful`);
      } else if (result.buildSuccess) {
        console.log(`    ⚠️ ${modelName}: Build successful, test failed`);
      } else {
        console.log(`    ❌ ${modelName}: Build failed`);
      }

    } catch (error) {
      console.error(`    ❌ Error testing ${modelName}:`, error);
      results.push({
        modelName,
        buildSuccess: false,
        testSuccess: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Step 4: Generate comprehensive reports
 */
async function generateReports(responses: any[], dockerDir: string, dockerResults: any[]) {
  const responsesDir = path.join(WORKDIR, 'responses');

  // Generate Docker testing results report
  ReportGenerator.generateDockerResultsReport(responsesDir, dockerDir, dockerResults);
  console.log(`  📄 Generated Docker testing results report`);

  // Generate evaluation report
  const evaluationReport = ReportGenerator.generateEvaluationReport(responses);
  
  const reportPath = path.join(WORKDIR, 'analysis', 'evaluation-report.json');
  if (!fs.existsSync(path.dirname(reportPath))) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(evaluationReport, null, 2));
  console.log(`  📄 Generated evaluation report`);
}

/**
 * Step 5: Print summary
 */
function printSummary(responses: any[], dockerResults: any[]) {
  const successfulTests = dockerResults.filter(r => r.testSuccess).length;
  const successfulBuilds = dockerResults.filter(r => r.buildSuccess).length;
  const modelsWithCode = responses.filter(r => extractTypeScriptCode(r.content)).length;

  console.log('🎉 Evaluation Pipeline Complete!');
  console.log('='.repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   - Total models tested: ${responses.length}`);
  console.log(`   - Models with TypeScript code: ${modelsWithCode}`);
  console.log(`   - Successful Docker builds: ${successfulBuilds}`);
  console.log(`   - Successful Docker tests: ${successfulTests}`);
  console.log(`   - Success rate: ${Math.round(successfulTests/responses.length*100)}%`);
  console.log();
  console.log(`📁 Results:`);
  console.log(`   - Responses: ${path.join(WORKDIR, 'responses')}`);
  console.log(`   - Docker environments: ${path.join(WORKDIR, 'docker-tests')}`);
  console.log(`   - Analysis reports: ${path.join(WORKDIR, 'analysis')}`);
  console.log();
  console.log(`🚀 Next steps:`);
  console.log(`   - Run 'cd ${path.join(WORKDIR, 'docker-tests')} && ./test-all.sh' to test all containers`);
  console.log(`   - Check individual model directories for detailed results`);
  console.log(`   - Review generated reports for comprehensive analysis`);
}

// Run the pipeline
main().catch(error => {
  console.error('❌ Pipeline failed:', error);
  process.exit(1);
});
