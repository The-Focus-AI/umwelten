/**
 * Simple Evaluation Example
 * 
 * Demonstrates how to use the new infrastructure for basic evaluations.
 * This example shows how to create a simple creative writing evaluation
 * using stimulus templates and evaluation strategies.
 */

import { SimpleEvaluation } from '../../src/evaluation/strategies/simple-evaluation.js';
import { createCreativeStimulus, LiteraryAnalysisTemplate } from '../../src/stimulus/templates/creative-templates.js';
import { getAvailableModels } from '../../src/providers/index.js';

async function runSimpleEvaluationExample() {
  console.log('🎭 Simple Evaluation Example: Literary Analysis');
  console.log('=' .repeat(50));

  // Get available models (filter to a few for demo)
  const allModels = await getAvailableModels();
  const models = allModels
    .filter(model => ['gpt-4', 'gpt-3.5-turbo', 'gemini-2.0-flash'].includes(model.name))
    .slice(0, 2); // Limit to 2 models for demo

  if (models.length === 0) {
    console.log('❌ No models available. Please check your API keys.');
    return;
  }

  console.log(`📚 Using ${models.length} models: ${models.map(m => m.name).join(', ')}`);

  // Create stimulus using template
  const stimulus = createCreativeStimulus(LiteraryAnalysisTemplate, {
    systemContext: "Focus on Mary Shelley's Frankenstein novel"
  });

  // Create evaluation
  const evaluation = new SimpleEvaluation(
    stimulus,
    models,
    "Who is the monster in Mary Shelley's Frankenstein? Explain your reasoning and support your analysis with textual evidence."
  );

  console.log('\n🚀 Running evaluation...');
  const startTime = Date.now();

  try {
    // Run evaluation
    const results = await evaluation.run();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Evaluation completed in ${duration}ms`);

    // Display results
    console.log('\n📊 Results:');
    console.log('-'.repeat(50));
    
    results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.model.name} (${result.model.provider})`);
      console.log(`   Response: ${result.response.content.substring(0, 200)}...`);
      console.log(`   Tokens: ${result.usage?.total || 'N/A'}`);
      console.log(`   Cost: $${result.cost?.totalCost?.toFixed(6) || 'N/A'}`);
      console.log(`   Duration: ${result.duration}ms`);
    });

    // Summary
    const totalCost = results.reduce((sum, r) => sum + (r.cost?.totalCost || 0), 0);
    const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total || 0), 0);
    
    console.log('\n📈 Summary:');
    console.log(`   Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Average Response Time: ${Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)}ms`);

  } catch (error) {
    console.error('❌ Evaluation failed:', error);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleEvaluationExample().catch(console.error);
}
