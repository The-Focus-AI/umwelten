# Stimulus System

## Overview

The stimulus system is the core of the umwelten evaluation framework. It provides a structured way to define cognitive tasks that models can perform, with support for templates, tools, and various cognitive domains.

## Core Concepts

### Stimulus
A stimulus represents a cognitive task that a model can perform. It defines:
- **Role**: The persona the model should adopt
- **Objective**: What the model should accomplish
- **Instructions**: How the model should approach the task
- **Output**: What the model should produce
- **Configuration**: Model settings (temperature, max tokens, etc.)

### Template
A template is a reusable stimulus definition for common task types. Templates provide:
- **Generic Structure**: Common patterns for similar tasks
- **Customization**: Easy parameterization for specific use cases
- **Consistency**: Standardized approaches across evaluations

### Tool Integration
Tools extend stimuli with external capabilities:
- **PDF Processing**: Extract text, metadata, and structure
- **Audio Processing**: Transcribe and analyze audio
- **Image Processing**: Analyze and extract features from images
- **Web Search**: Access real-time information
- **File Operations**: Read and process files

## Stimulus Structure

### Basic Stimulus
```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';

const myStimulus = new Stimulus({
  id: 'my-stimulus',
  name: 'My Stimulus',
  description: 'A description of what this stimulus does',
  
  role: 'expert analyst',
  objective: 'analyze data and provide insights',
  instructions: [
    'Examine the data carefully',
    'Identify key patterns and trends',
    'Provide actionable recommendations'
  ],
  output: [
    'Structured analysis report',
    'Key findings and insights',
    'Recommendations for next steps'
  ],
  
  temperature: 0.7,
  maxTokens: 1500,
  runnerType: 'base'
});
```

### Stimulus with Tools
```typescript
import { Stimulus } from '../src/stimulus/stimulus.js';
import { PDFTools } from '../src/stimulus/tools/pdf-tools.js';

const pdfAnalysisStimulus = new Stimulus({
  id: 'pdf-analysis',
  name: 'PDF Analysis',
  description: 'Analyze PDF documents with tool support',
  
  role: 'document analyst',
  objective: 'analyze PDF documents and extract key information',
  instructions: [
    'Use the PDF tools to extract text and metadata',
    'Analyze the content for key themes and insights',
    'Provide a structured summary of findings'
  ],
  output: [
    'Document summary',
    'Key themes and topics',
    'Metadata and statistics'
  ],
  
  tools: {
    extractText: PDFTools.extractText,
    extractMetadata: PDFTools.extractMetadata,
    analyzeStructure: PDFTools.analyzeStructure
  },
  
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});
```

## Template System

### Creative Templates
```typescript
import { LiteraryAnalysisTemplate } from '../src/stimulus/templates/creative-templates.js';

// Use a pre-defined template
const analysis = new Interaction(model, LiteraryAnalysisTemplate);
analysis.addMessage({
  role: 'user',
  content: 'Analyze the themes in "To Kill a Mockingbird"'
});
```

### Coding Templates
```typescript
import { CodeGenerationTemplate } from '../src/stimulus/templates/coding-templates.js';

// Use a coding template
const codeGen = new Interaction(model, CodeGenerationTemplate);
codeGen.addMessage({
  role: 'user',
  content: 'Write a Python function to sort a list of numbers'
});
```

### Analysis Templates
```typescript
import { DocumentAnalysisTemplate } from '../src/stimulus/templates/analysis-templates.js';

// Use an analysis template
const docAnalysis = new Interaction(model, DocumentAnalysisTemplate);
docAnalysis.addMessage({
  role: 'user',
  content: 'Analyze this document for key insights'
});
```

## Tool Integration

### PDF Tools
```typescript
import { PDFTools } from '../src/stimulus/tools/pdf-tools.js';

const stimulus = new Stimulus({
  // ... other properties
  tools: {
    extractText: PDFTools.extractText,
    extractMetadata: PDFTools.extractMetadata,
    analyzeStructure: PDFTools.analyzeStructure
  }
});
```

### Audio Tools
```typescript
import { AudioTools } from '../src/stimulus/tools/audio-tools.js';

const stimulus = new Stimulus({
  // ... other properties
  tools: {
    transcribe: AudioTools.transcribe,
    identifyLanguage: AudioTools.identifyLanguage,
    extractFeatures: AudioTools.extractFeatures
  }
});
```

### Image Tools
```typescript
import { ImageTools } from '../src/stimulus/tools/image-tools.js';

const stimulus = new Stimulus({
  // ... other properties
  tools: {
    analyzeImage: ImageTools.analyzeImage,
    extractText: ImageTools.extractText,
    detectObjects: ImageTools.detectObjects
  }
});
```

## Cognitive Domains

### Creative Writing
- **Literary Analysis**: Analyze themes, symbolism, and literary devices
- **Poetry Generation**: Write poetry in various forms
- **Creative Writing**: Generate creative content
- **Storytelling**: Create narratives and stories

### Code Generation
- **Function Generation**: Write specific functions
- **Debugging**: Find and fix code issues
- **Code Review**: Analyze and improve code
- **Architecture Design**: Design system architectures

### Analysis Tasks
- **Document Analysis**: Extract insights from documents
- **Data Analysis**: Analyze datasets and trends
- **Research Synthesis**: Combine multiple sources
- **Report Generation**: Create structured reports

## Best Practices

### 1. Design Clear Objectives
- Be specific about what the model should accomplish
- Use clear, actionable language
- Avoid ambiguous or vague instructions

### 2. Provide Good Instructions
- Break down complex tasks into steps
- Include examples when helpful
- Specify the expected output format
- Provide context and background

### 3. Use Appropriate Configuration
- Set temperature based on task requirements
- Adjust max tokens for expected output length
- Choose the right runner type for the task

### 4. Leverage Templates
- Use existing templates when possible
- Customize templates for specific needs
- Create new templates for common patterns
- Document template usage

### 5. Integrate Tools Effectively
- Use tools to extend model capabilities
- Provide clear tool descriptions
- Handle tool errors gracefully
- Test tool integrations thoroughly

## Examples

### Simple Text Analysis
```typescript
const textAnalysis = new Stimulus({
  role: 'text analyst',
  objective: 'analyze text for sentiment and key themes',
  instructions: [
    'Read the text carefully',
    'Identify the overall sentiment',
    'Extract key themes and topics',
    'Provide a structured analysis'
  ],
  output: [
    'Sentiment score and explanation',
    'List of key themes',
    'Supporting evidence from text'
  ],
  temperature: 0.3,
  maxTokens: 1000
});
```

### Complex Multi-Tool Analysis
```typescript
const complexAnalysis = new Stimulus({
  role: 'research analyst',
  objective: 'conduct comprehensive research and analysis',
  instructions: [
    'Use available tools to gather information',
    'Analyze the collected data',
    'Synthesize findings into a coherent report',
    'Provide recommendations based on analysis'
  ],
  output: [
    'Research summary',
    'Key findings and insights',
    'Data analysis results',
    'Actionable recommendations'
  ],
  tools: {
    webSearch: WebTools.search,
    pdfAnalysis: PDFTools.analyze,
    dataProcessing: DataTools.process
  },
  temperature: 0.5,
  maxTokens: 3000
});
```

## API Reference

For detailed API documentation, see the [API Reference](../api/stimulus-system.md).

## Related Documentation

- [Template System](template-system.md)
- [Tool Integration](tool-integration.md)
- [Cognitive Domains](cognitive-domains.md)
- [Best Practices](best-practices.md)
