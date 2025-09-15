# Batch Evaluation Example

This example demonstrates how to process multiple inputs with the same model using the BatchEvaluation strategy, including tool integration for document processing.

## Running the Example

```bash
pnpm tsx scripts/examples/batch-evaluation-example.ts
```

## What This Example Shows

- **Batch Processing**: Process multiple inputs with the same model
- **Tool Integration**: Using PDF tools for document analysis
- **Document Processing**: Analyze multiple documents in batch
- **Performance Optimization**: Parallel processing for efficiency

## Code Walkthrough

### 1. Import Dependencies

```typescript
import { BatchEvaluation } from '../../src/evaluation/strategies/batch-evaluation.js';
import { DocumentAnalysisTemplate } from '../../src/stimulus/templates/analysis-templates.js';
import { PDFTools } from '../../src/stimulus/tools/pdf-tools.js';
import { getAvailableModels } from '../../src/providers/index.js';
```

### 2. Create Batch Evaluation

```typescript
const evaluation = new BatchEvaluation({
  id: "document-analysis-batch",
  name: "Document Analysis Batch",
  description: "Analyze multiple documents using batch processing",
  
  // Enable parallel processing for better performance
  parallel: {
    enabled: true,
    maxConcurrency: 3
  }
});
```

### 3. Define Test Cases with Tool Integration

```typescript
const testCases = [
  {
    id: "document-1",
    name: "Research Paper Analysis",
    stimulus: new Stimulus({
      id: 'document-analysis',
      name: 'Document Analysis',
      description: 'Analyze documents with PDF tools',
      
      role: 'document analyst',
      objective: 'analyze documents and extract key insights',
      instructions: [
        'Use PDF tools to extract text and metadata',
        'Analyze the content for key themes and insights',
        'Provide a structured summary of findings'
      ],
      output: [
        'Document summary',
        'Key themes and topics',
        'Metadata and statistics'
      ],
      
      // Integrate PDF tools
      tools: {
        extractText: PDFTools.extractText,
        extractMetadata: PDFTools.extractMetadata,
        analyzeStructure: PDFTools.analyzeStructure
      },
      
      temperature: 0.3,
      maxTokens: 2000,
      runnerType: 'base'
    }),
    input: {
      documentPath: "input/documents/research-paper.pdf",
      analysisType: "comprehensive",
      focusAreas: ["methodology", "findings", "conclusions"]
    }
  },
  {
    id: "document-2",
    name: "Technical Manual Analysis",
    stimulus: DocumentAnalysisTemplate,
    input: {
      documentPath: "input/documents/technical-manual.pdf",
      analysisType: "technical",
      focusAreas: ["procedures", "specifications", "troubleshooting"]
    }
  },
  {
    id: "document-3",
    name: "Financial Report Analysis",
    stimulus: DocumentAnalysisTemplate,
    input: {
      documentPath: "input/documents/financial-report.pdf",
      analysisType: "financial",
      focusAreas: ["revenue", "expenses", "trends", "projections"]
    }
  }
];
```

### 4. Select Model and Run Batch Evaluation

```typescript
const allModels = await getAvailableModels();
const model = allModels.find(m => m.name === 'gpt-4' && m.provider === 'openrouter');

if (!model) {
  console.log('❌ Model not available. Please check your API keys.');
  return;
}

console.log(`🤖 Using model: ${model.name} (${model.provider})`);

const result = await evaluation.run({
  model,
  testCases
});
```

### 5. Display Batch Results

```typescript
console.log(`\n📊 Batch Evaluation Results:`);
console.log(`- Documents processed: ${testCases.length}`);
console.log(`- Total responses: ${result.responses.length}`);
console.log(`- Total cost: $${result.metrics.totalCost.toFixed(6)}`);
console.log(`- Total time: ${result.metrics.totalTime}ms`);
console.log(`- Avg time per document: ${Math.round(result.metrics.totalTime / testCases.length)}ms`);

// Display results by document
testCases.forEach((testCase, index) => {
  const response = result.responses[index];
  console.log(`\n📄 ${testCase.name}:`);
  console.log(`  - Status: ${response.metadata.error ? 'Error' : 'Success'}`);
  console.log(`  - Tokens: ${response.metadata.tokenUsage?.total || 0}`);
  console.log(`  - Time: ${response.metadata.endTime - response.metadata.startTime}ms`);
  console.log(`  - Preview: ${response.content.substring(0, 200)}...`);
});
```

## Key Features Demonstrated

### Batch Processing
The BatchEvaluation strategy:
- Processes multiple inputs with the same model
- Handles errors gracefully (continues processing if one fails)
- Provides aggregated metrics
- Supports parallel processing for efficiency

### Tool Integration
The example shows how to integrate PDF tools:
- **extractText**: Extract text content from PDFs
- **extractMetadata**: Get document metadata
- **analyzeStructure**: Analyze document structure

### Parallel Processing
```typescript
const evaluation = new BatchEvaluation({
  // ... other options
  parallel: {
    enabled: true,
    maxConcurrency: 3 // Process up to 3 documents simultaneously
  }
});
```

## Advanced Usage

### Custom Tool Integration

```typescript
import { AudioTools, ImageTools } from '../../src/stimulus/tools/index.js';

// Audio analysis stimulus
const audioAnalysisStimulus = new Stimulus({
  // ... basic properties
  tools: {
    transcribe: AudioTools.transcribe,
    identifyLanguage: AudioTools.identifyLanguage,
    extractFeatures: AudioTools.extractFeatures
  }
});

// Image analysis stimulus
const imageAnalysisStimulus = new Stimulus({
  // ... basic properties
  tools: {
    analyzeImage: ImageTools.analyzeImage,
    extractText: ImageTools.extractText,
    detectObjects: ImageTools.detectObjects
  }
});
```

### Error Handling

```typescript
const result = await evaluation.run({
  model,
  testCases
});

// Check for errors
const errors = result.responses.filter(r => r.metadata.error);
if (errors.length > 0) {
  console.log(`⚠️  ${errors.length} documents failed to process:`);
  errors.forEach((response, index) => {
    console.log(`  - ${testCases[index].name}: ${response.metadata.error}`);
  });
}

const successful = result.responses.filter(r => !r.metadata.error);
console.log(`✅ Successfully processed ${successful.length}/${testCases.length} documents`);
```

### Progress Tracking

```typescript
const evaluation = new BatchEvaluation({
  id: "document-analysis-batch",
  name: "Document Analysis Batch",
  description: "Analyze multiple documents using batch processing",
  
  // Enable progress tracking
  progress: {
    enabled: true,
    updateInterval: 1000 // Update every second
  }
});

// The evaluation will automatically log progress
// Processing document 1/3...
// Processing document 2/3...
// Processing document 3/3...
```

### Custom Processing Logic

```typescript
// Process documents with different analysis types
const testCases = documents.map((doc, index) => ({
  id: `document-${index + 1}`,
  name: doc.name,
  stimulus: getStimulusForDocumentType(doc.type),
  input: {
    documentPath: doc.path,
    analysisType: doc.analysisType,
    focusAreas: doc.focusAreas
  }
}));

function getStimulusForDocumentType(type: string) {
  switch (type) {
    case 'research':
      return ResearchAnalysisTemplate;
    case 'technical':
      return TechnicalAnalysisTemplate;
    case 'financial':
      return FinancialAnalysisTemplate;
    default:
      return DocumentAnalysisTemplate;
  }
}
```

## Expected Output

```
📄 Batch Evaluation Example: Document Analysis
==============================================
🤖 Using model: gpt-4 (openrouter)
📚 Processing 3 documents...

📊 Batch Evaluation Results:
- Documents processed: 3
- Total responses: 3
- Total cost: $0.004500
- Total time: 4500ms
- Avg time per document: 1500ms

📄 Research Paper Analysis:
  - Status: Success
  - Tokens: 1200
  - Time: 1800ms
  - Preview: This research paper presents a comprehensive analysis of machine learning applications in healthcare. The methodology section outlines a systematic approach to data collection and analysis...

📄 Technical Manual Analysis:
  - Status: Success
  - Tokens: 950
  - Time: 1200ms
  - Preview: The technical manual provides detailed procedures for system maintenance and troubleshooting. Key procedures include regular system checks, software updates, and hardware diagnostics...

📄 Financial Report Analysis:
  - Status: Success
  - Tokens: 1100
  - Time: 1500ms
  - Preview: The financial report shows strong revenue growth of 15% year-over-year, with operating expenses remaining stable. Key financial metrics indicate healthy cash flow and improved profitability...

✅ Batch evaluation completed successfully!
```

## Use Cases

### Document Processing
- Analyze multiple PDFs in batch
- Extract structured data from documents
- Process different document types
- Generate summaries and insights

### Content Analysis
- Analyze multiple articles or papers
- Extract key themes and topics
- Compare content across sources
- Generate comparative reports

### Data Processing
- Process multiple data files
- Extract insights from datasets
- Generate reports and summaries
- Validate data quality

## Performance Tips

### Optimize Concurrency
```typescript
// Adjust concurrency based on your system and API limits
const evaluation = new BatchEvaluation({
  parallel: {
    enabled: true,
    maxConcurrency: 5 // Increase for more parallel processing
  }
});
```

### Use Caching
```typescript
const evaluation = new BatchEvaluation({
  // ... other options
  cache: {
    enabled: true,
    ttl: 3600 // Cache results for 1 hour
  }
});
```

### Monitor Resource Usage
```typescript
// Track memory usage for large batches
const result = await evaluation.run({
  model,
  testCases
});

console.log(`Memory usage: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
```

## Next Steps

- Try the [Complex Pipeline Example](/examples/complex-pipeline) for multi-step workflows
- Explore the [Comprehensive Analysis Example](/examples/comprehensive-analysis) for detailed performance analysis
- Check out the [Tool Integration Examples](/examples/tool-integration) for more tool usage patterns
