#!/usr/bin/env tsx

/**
 * Docker Output Analyzer
 * 
 * This script analyzes the Docker outputs from the TypeScript evaluation
 * and provides detailed insights into code quality and output correctness.
 */

import fs from 'fs';
import path from 'path';
import { AdvancedCodeAnalyzer } from '../src/evaluation/advanced-code-analyzer.js';

const EVALUATION_ID = 'ollama-typescript-eval';
const WORKDIR = path.join(process.cwd(), 'output/evaluations', EVALUATION_ID);

async function main() {
  console.log('🔍 Docker Output Analysis');
  console.log('='.repeat(50));
  
  // Check if analysis directories exist
  const dockerOutputsDir = path.join(WORKDIR, 'analysis', 'docker-outputs');
  const codeQualityDir = path.join(WORKDIR, 'analysis', 'code-quality');
  
  if (!fs.existsSync(dockerOutputsDir)) {
    console.log('❌ No Docker outputs found. Run the evaluation first.');
    return;
  }
  
  // Get all Docker output files
  const outputFiles = fs.readdirSync(dockerOutputsDir)
    .filter(file => file.endsWith('-output.txt'))
    .sort();
  
  console.log(`📄 Found ${outputFiles.length} Docker output files\n`);
  
  for (const outputFile of outputFiles) {
    const modelName = outputFile.replace('-output.txt', '').replace(/-/g, ':');
    const outputPath = path.join(dockerOutputsDir, outputFile);
    const analysisPath = path.join(codeQualityDir, outputFile.replace('-output.txt', '-analysis.json'));
    
    console.log(`🤖 ${modelName}`);
    console.log('-'.repeat(40));
    
    try {
      // Read Docker output
      const dockerOutput = fs.readFileSync(outputPath, 'utf8');
      const outputAnalysis = AdvancedCodeAnalyzer.analyzeDockerOutput(dockerOutput);
      
      console.log(`📊 Output Analysis:`);
      console.log(`   Items generated: ${outputAnalysis.itemCount}`);
      console.log(`   Unique items: ${outputAnalysis.uniqueItemCount}`);
      console.log(`   Target achieved: ${outputAnalysis.uniqueItemCount >= 1042 ? '✅' : '❌'} (${outputAnalysis.uniqueItemCount}/1042)`);
      console.log(`   Output format: ${outputAnalysis.outputFormat}`);
      console.log(`   Average length: ${outputAnalysis.averageLength.toFixed(1)} characters`);
      
      if (outputAnalysis.errors.length > 0) {
        console.log(`   ❌ Errors found: ${outputAnalysis.errors.length}`);
        outputAnalysis.errors.slice(0, 2).forEach(error => {
          console.log(`      - ${error.substring(0, 100)}...`);
        });
      }
      
      // Show sample items
      if (outputAnalysis.sampleItems.length > 0) {
        console.log(`   📝 Sample items:`);
        outputAnalysis.sampleItems.slice(0, 5).forEach((item, i) => {
          console.log(`      ${i + 1}. ${item}`);
        });
      }
      
      // Read comprehensive analysis if available
      if (fs.existsSync(analysisPath)) {
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        console.log(`\n🏆 Code Quality Assessment: ${analysis.overallAssessment}`);
        
        if (analysis.recommendations.length > 0) {
          console.log(`💡 Recommendations:`);
          analysis.recommendations.forEach((rec: string) => {
            console.log(`   - ${rec}`);
          });
        }
      }
      
    } catch (error) {
      console.log(`❌ Error analyzing ${modelName}: ${error}`);
    }
    
    console.log('\n');
  }
  
  // Generate summary
  console.log('📈 Summary');
  console.log('='.repeat(50));
  
  const summaryData = outputFiles.map(file => {
    const outputPath = path.join(dockerOutputsDir, file);
    const dockerOutput = fs.readFileSync(outputPath, 'utf8');
    const analysis = AdvancedCodeAnalyzer.analyzeDockerOutput(dockerOutput);
    return {
      model: file.replace('-output.txt', '').replace(/-/g, ':'),
      itemCount: analysis.itemCount,
      uniqueCount: analysis.uniqueItemCount,
      achievesTarget: analysis.uniqueItemCount >= 1042,
      hasErrors: analysis.errors.length > 0
    };
  });
  
  const successful = summaryData.filter(s => s.achievesTarget).length;
  const withErrors = summaryData.filter(s => s.hasErrors).length;
  
  console.log(`✅ Models achieving target (1042+ unique items): ${successful}/${summaryData.length}`);
  console.log(`❌ Models with execution errors: ${withErrors}/${summaryData.length}`);
  
  // Top performers
  const topPerformers = summaryData
    .sort((a, b) => b.uniqueCount - a.uniqueCount)
    .slice(0, 3);
  
  console.log(`\n🏆 Top Performers:`);
  topPerformers.forEach((performer, i) => {
    const status = performer.achievesTarget ? '✅' : '❌';
    console.log(`   ${i + 1}. ${performer.model}: ${performer.uniqueCount} unique items ${status}`);
  });
  
  console.log(`\n💡 To view detailed analysis for a specific model:`);
  console.log(`   cat output/evaluations/${EVALUATION_ID}/analysis/docker-outputs/[model]-output.txt`);
  console.log(`   cat output/evaluations/${EVALUATION_ID}/analysis/code-quality/[model]-analysis.json`);
}

// Run the analysis
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
