/**
 * Matrix Evaluation Example
 * 
 * Demonstrates how to use matrix evaluation for multi-dimensional testing.
 * This example shows how to test different creative writing styles across
 * multiple models and temperature settings.
 */

import { MatrixEvaluation } from '../../src/evaluation/strategies/matrix-evaluation.js';
import { createCreativeStimulus, PoetryGenerationTemplate } from '../../src/stimulus/templates/creative-templates.js';
import { getAvailableModels } from '../../src/providers/index.js';

async function runMatrixEvaluationExample() {
  console.log('🎭 Matrix Evaluation Example: Poetry Generation');
  console.log('=' .repeat(50));

  // Get available models
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
  const stimulus = createCreativeStimulus(PoetryGenerationTemplate, {
    systemContext: "Focus on writing about nature and the environment"
  });

  // Define matrix dimensions
  const dimensions = {
    poeticForm: ['haiku', 'sonnet', 'free-verse', 'limerick'],
    theme: ['ocean', 'forest', 'mountain', 'desert'],
    mood: ['peaceful', 'dramatic', 'melancholy', 'joyful']
  };

  // Create prompt template
  const promptTemplate = (dims: Record<string, any>) => 
    `Write a ${dims.poeticForm} about a ${dims.theme} with a ${dims.mood} mood.`;

  // Create matrix evaluation
  const evaluation = new MatrixEvaluation(
    stimulus,
    models,
    dimensions,
    promptTemplate
  );

  console.log('\n🚀 Running matrix evaluation...');
  console.log(`📊 Testing ${Object.values(dimensions).reduce((a, b) => a * b.length, 1)} combinations`);
  
  const startTime = Date.now();

  try {
    // Run evaluation
    const results = await evaluation.run();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Matrix evaluation completed in ${duration}ms`);

    // Display results summary
    console.log('\n📊 Results Summary:');
    console.log('-'.repeat(50));
    
    // Group results by model
    const resultsByModel = results.reduce((acc, result) => {
      const key = `${result.model.name} (${result.model.provider})`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(result);
      return acc;
    }, {} as Record<string, any[]>);

    Object.entries(resultsByModel).forEach(([modelName, modelResults]) => {
      console.log(`\n${modelName}:`);
      console.log(`  Total responses: ${modelResults.length}`);
      console.log(`  Average length: ${Math.round(modelResults.reduce((sum, r) => sum + r.response.content.length, 0) / modelResults.length)} chars`);
      console.log(`  Total cost: $${modelResults.reduce((sum, r) => sum + (r.cost?.totalCost || 0), 0).toFixed(6)}`);
    });

    // Show sample results
    console.log('\n📝 Sample Results:');
    console.log('-'.repeat(50));
    
    const sampleResults = results.slice(0, 3);
    sampleResults.forEach((result, index) => {
      const dims = result.dimensions;
      console.log(`\n${index + 1}. ${dims.poeticForm} about ${dims.theme} (${dims.mood})`);
      console.log(`   Model: ${result.model.name}`);
      console.log(`   Response: ${result.response.content.substring(0, 150)}...`);
    });

    // Summary statistics
    const totalCost = results.reduce((sum, r) => sum + (r.cost?.totalCost || 0), 0);
    const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total || 0), 0);
    const avgResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    console.log('\n📈 Matrix Summary:');
    console.log(`   Total Combinations: ${results.length}`);
    console.log(`   Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Average Response Time: ${Math.round(avgResponseTime)}ms`);
    console.log(`   Cost per Combination: $${(totalCost / results.length).toFixed(6)}`);

  } catch (error) {
    console.error('❌ Matrix evaluation failed:', error);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runMatrixEvaluationExample().catch(console.error);
}
