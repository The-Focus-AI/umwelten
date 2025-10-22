/**
 * Batch Evaluation Example
 * 
 * Demonstrates how to use batch evaluation for processing large datasets.
 * This example shows how to analyze multiple documents using the new
 * infrastructure and stimulus templates.
 */

import { BatchEvaluation } from '../../src/evaluation/strategies/batch-evaluation.js';
import { createAnalysisStimulus, DocumentAnalysisTemplate } from '../../src/stimulus/templates/analysis-templates.js';
import { getAllModels } from '../../src/cognition/models.js';
import { EvaluationCache } from '../../src/evaluation/caching/cache-service.js';

async function runBatchEvaluationExample() {
  console.log('📄 Batch Evaluation Example: Document Analysis');
  console.log('=' .repeat(50));

  // Get available models
  const allModels = await getAllModels();
  const models = allModels
    .filter(model => ['gemma3:12b', 'qwen2.5:14b', 'llama3.2:latest'].includes(model.name))
    .slice(0, 2); // Limit to 2 models for demo

  if (models.length === 0) {
    console.log('❌ No models available. Please check your API keys.');
    return;
  }

  console.log(`📚 Using ${models.length} models: ${models.map(m => m.name).join(', ')}`);

  // Create stimulus using template
  const stimulus = createAnalysisStimulus(DocumentAnalysisTemplate, {
    systemContext: "Focus on extracting key information and identifying document types"
  });

  // Create sample documents (in a real scenario, these would be file paths)
  const sampleDocuments = [
    {
      id: 'doc1',
      title: 'Project Proposal',
      content: 'This document outlines a new software development project. The project aims to create a web application for managing customer relationships. Key features include user authentication, data visualization, and reporting capabilities. The estimated timeline is 6 months with a budget of $100,000.'
    },
    {
      id: 'doc2', 
      title: 'Meeting Minutes',
      content: 'Meeting held on January 15, 2024. Attendees: John Smith, Jane Doe, Bob Johnson. Discussion topics: Q1 budget review, new hire onboarding process, and upcoming product launch. Action items: John to finalize budget by Friday, Jane to prepare onboarding materials, Bob to coordinate with marketing team.'
    },
    {
      id: 'doc3',
      title: 'Technical Specification',
      content: 'API Specification v2.1. This document describes the REST API endpoints for the user management system. Endpoints include: POST /users (create user), GET /users/:id (retrieve user), PUT /users/:id (update user), DELETE /users/:id (delete user). Authentication required for all endpoints using JWT tokens.'
    },
    {
      id: 'doc4',
      title: 'Financial Report',
      content: 'Q4 2023 Financial Summary. Revenue: $2.5M (up 15% from Q3). Expenses: $1.8M (up 8% from Q3). Net Profit: $700K (up 25% from Q3). Key drivers: increased sales in enterprise segment, cost optimization in operations. Outlook: expecting 20% growth in Q1 2024.'
    }
  ];

  console.log(`📄 Processing ${sampleDocuments.length} documents`);

  // Create cache for this evaluation
  const cache = new EvaluationCache('batch-evaluation-example', { verbose: true });

  // Convert documents to batch items
  const batchItems = sampleDocuments.map((doc, index) => ({
    id: doc.id,
    content: `Analyze this document:\n\nTitle: ${doc.title}\n\nContent:\n${doc.content}`,
    metadata: { originalTitle: doc.title }
  }));

  // Create batch evaluation
  const evaluation = new BatchEvaluation(
    stimulus,
    models,
    "Analyze the following document and provide insights about its content, structure, and key themes.\n\n{content}",
    cache,
    {
      items: batchItems,
      maxConcurrent: 2,
      groupByModel: false,
      progressCallback: (progress) => {
        console.log(`Progress: ${progress.completed}/${progress.total} (${progress.percentage.toFixed(1)}%) - ${progress.currentModel} - ${progress.currentItem}`);
      }
    }
  );

  console.log('\n🚀 Running batch evaluation...');
  const startTime = Date.now();

  try {
    // Run evaluation
    const results = await evaluation.run();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Batch evaluation completed in ${duration}ms`);

    // Display results
    console.log('\n📊 Results by Document:');
    console.log('-'.repeat(50));
    
    // Group results by document
    const resultsByDocument = results.reduce((acc, result) => {
      const docId = result.item.id;
      if (!acc[docId]) acc[docId] = [];
      acc[docId].push(result);
      return acc;
    }, {} as Record<string, any[]>);

    Object.entries(resultsByDocument).forEach(([docId, docResults]) => {
      const doc = sampleDocuments.find(d => d.id === docId);
      console.log(`\n📄 ${doc?.title} (${docId}):`);
      
      docResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.model.name} (${result.model.provider})`);
        console.log(`     Response: ${result.response.content.substring(0, 100)}...`);
        console.log(`     Tokens: ${result.usage?.total || 'N/A'}`);
        console.log(`     Cost: $${result.cost?.totalCost?.toFixed(6) || 'N/A'}`);
      });
    });

    // Summary statistics
    const totalCost = results.reduce((sum, r) => sum + (r.cost?.totalCost || 0), 0);
    const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total || 0), 0);
    const avgResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    console.log('\n📈 Batch Summary:');
    console.log(`   Total Documents: ${sampleDocuments.length}`);
    console.log(`   Total Responses: ${results.length}`);
    console.log(`   Total Cost: $${totalCost.toFixed(6)}`);
    console.log(`   Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Average Response Time: ${Math.round(avgResponseTime)}ms`);
    console.log(`   Cost per Document: $${(totalCost / sampleDocuments.length).toFixed(6)}`);

    // Show document type analysis
    console.log('\n🔍 Document Type Analysis:');
    console.log('-'.repeat(30));
    
    const documentTypes = results.map(result => {
      const content = result.response.content.toLowerCase();
      if (content.includes('proposal') || content.includes('project')) return 'Project Proposal';
      if (content.includes('meeting') || content.includes('minutes')) return 'Meeting Minutes';
      if (content.includes('api') || content.includes('technical')) return 'Technical Specification';
      if (content.includes('financial') || content.includes('revenue')) return 'Financial Report';
      return 'Unknown';
    });

    const typeCounts = documentTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(typeCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} responses`);
    });

  } catch (error) {
    console.error('❌ Batch evaluation failed:', error);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runBatchEvaluationExample().catch(console.error);
}
