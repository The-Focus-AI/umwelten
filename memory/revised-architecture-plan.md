# Revised Architecture Plan: Infrastructure-First Evaluation System

## 🎯 Core Philosophy

**`src/` = Infrastructure & Tools**  
**`scripts/` = Exploratory Tests & Compositions**

The umwelten project should provide **reusable infrastructure** for building AI model evaluations, not specific test implementations. Scripts are exploratory compositions that demonstrate how to use the infrastructure.

## 📁 Directory Structure

```
umwelten/
├── src/                          # Core Infrastructure
│   ├── evaluation/               # Evaluation Framework
│   │   ├── strategies/           # Reusable evaluation strategies
│   │   │   ├── simple-evaluation.ts
│   │   │   ├── code-generation-evaluation.ts
│   │   │   ├── matrix-evaluation.ts
│   │   │   ├── batch-evaluation.ts
│   │   │   ├── complex-pipeline.ts
│   │   │   └── index.ts
│   │   ├── caching/              # Caching Infrastructure
│   │   │   ├── cache-service.ts
│   │   │   ├── file-cache.ts
│   │   │   ├── model-cache.ts
│   │   │   └── index.ts
│   │   ├── analysis/             # Result Analysis Tools
│   │   │   ├── result-analyzer.ts
│   │   │   ├── report-generator.ts
│   │   │   ├── comparison-tools.ts
│   │   │   └── index.ts
│   │   ├── types/                # Type Definitions
│   │   │   ├── evaluation-types.ts
│   │   │   ├── result-types.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── stimulus/                 # Stimulus Building Blocks
│   │   ├── templates/            # Generic Templates
│   │   │   ├── creative-templates.ts
│   │   │   ├── coding-templates.ts
│   │   │   ├── analysis-templates.ts
│   │   │   └── index.ts
│   │   ├── tools/                # Tool Integration
│   │   │   ├── pdf-tools.ts
│   │   │   ├── audio-tools.ts
│   │   │   ├── image-tools.ts
│   │   │   └── index.ts
│   │   ├── stimulus.ts           # Core Stimulus Class
│   │   └── index.ts
│   ├── cognition/                # Model Interfaces
│   │   ├── models.ts
│   │   ├── runner.ts
│   │   ├── smart-runner.ts
│   │   └── types.ts
│   ├── interaction/              # Interaction Management
│   │   ├── interaction.ts
│   │   └── types.ts
│   ├── providers/                # AI Provider Integrations
│   │   ├── google.ts
│   │   ├── openrouter.ts
│   │   ├── ollama.ts
│   │   ├── lmstudio.ts
│   │   └── index.ts
│   ├── cli/                      # CLI Interface
│   │   ├── cli.ts
│   │   ├── run.ts
│   │   ├── chat.ts
│   │   ├── models.ts
│   │   └── tools.ts
│   └── memory/                   # Memory System
│       ├── memory-store.ts
│       ├── fact-extractor.ts
│       └── types.ts
├── scripts/                      # Exploratory Tests & Compositions
│   ├── creative/                 # Creative Writing Tests
│   │   ├── frankenstein.ts
│   │   ├── cat-poem.ts
│   │   ├── poem-test.ts
│   │   ├── temperature.ts
│   │   └── haiku.ts
│   ├── coding/                   # Code Generation Tests
│   │   ├── typescript-evaluation.ts
│   │   ├── python-evaluation.ts
│   │   ├── multi-language-evaluation.ts
│   │   ├── debugging-evaluation.ts
│   │   └── api-development.ts
│   ├── analysis/                 # Analysis Tests
│   │   ├── pdf-identify.ts
│   │   ├── pdf-parsing.ts
│   │   ├── transcribe.ts
│   │   ├── image-parsing.ts
│   │   └── data-analysis.ts
│   ├── complex/                  # Complex Evaluation Tests
│   │   ├── image-feature-batch.ts
│   │   ├── matrix-evaluations.ts
│   │   ├── multi-model-comparison.ts
│   │   └── performance-benchmarks.ts
│   ├── tools/                    # Tool Usage Tests
│   │   ├── calculator-test.ts
│   │   ├── weather-test.ts
│   │   ├── file-analysis-test.ts
│   │   └── multi-tool-test.ts
│   └── examples/                 # Example Compositions
│       ├── simple-evaluation-example.ts
│       ├── matrix-evaluation-example.ts
│       ├── batch-evaluation-example.ts
│       └── complex-pipeline-example.ts
├── docs/                         # Documentation
│   ├── architecture/             # Architecture Documentation
│   │   ├── overview.md
│   │   ├── evaluation-framework.md
│   │   ├── stimulus-system.md
│   │   └── caching-system.md
│   ├── guides/                   # User Guides
│   │   ├── getting-started.md
│   │   ├── creating-evaluations.md
│   │   ├── writing-scripts.md
│   │   └── best-practices.md
│   ├── api/                      # API Documentation
│   │   ├── evaluation-strategies.md
│   │   ├── stimulus-templates.md
│   │   ├── caching-api.md
│   │   └── cli-reference.md
│   └── examples/                 # Example Documentation
│       ├── creative-writing.md
│       ├── code-generation.md
│       ├── analysis-tasks.md
│       └── complex-evaluations.md
└── tests/                        # Test Suite
    ├── unit/                     # Unit Tests
    ├── integration/              # Integration Tests
    └── e2e/                      # End-to-End Tests
```

## 🏗️ Core Infrastructure Components

### 1. Evaluation Strategies (`src/evaluation/strategies/`)

#### SimpleEvaluation
```typescript
export class SimpleEvaluation {
  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    prompt: string,
    options?: EvaluationOptions
  );
  
  async run(): Promise<EvaluationResult[]>;
}
```

#### CodeGenerationEvaluation
```typescript
export class CodeGenerationEvaluation {
  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    prompt: string,
    language: string,
    validation: CodeValidationConfig,
    options?: EvaluationOptions
  );
  
  async run(): Promise<CodeGenerationResult[]>;
}
```

#### MatrixEvaluation
```typescript
export class MatrixEvaluation {
  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    dimensions: Record<string, any[]>,
    promptTemplate: (dimensions: Record<string, any>) => string,
    options?: EvaluationOptions
  );
  
  async run(): Promise<MatrixResult[]>;
}
```

#### BatchEvaluation
```typescript
export class BatchEvaluation {
  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    inputs: any[],
    inputProcessor: (input: any) => string,
    options?: EvaluationOptions
  );
  
  async run(): Promise<BatchResult[]>;
}
```

#### ComplexPipeline
```typescript
export class ComplexPipeline {
  constructor(
    stimulus: Stimulus,
    models: ModelDetails[],
    steps: EvaluationStep[],
    options?: EvaluationOptions
  );
  
  async run(): Promise<ComplexResult[]>;
}
```

### 2. Stimulus Templates (`src/stimulus/templates/`)

#### Creative Templates
```typescript
export const LiteraryAnalysisTemplate = {
  role: "literary critic",
  objective: "analyze literary works",
  instructions: [
    "Provide deep literary analysis",
    "Consider themes, symbolism, and literary devices",
    "Support analysis with textual evidence"
  ],
  output: [
    "Structured literary analysis",
    "Key themes and their development",
    "Evidence from the text"
  ],
  temperature: 0.7,
  maxTokens: 1500
};

export const PoetryGenerationTemplate = {
  role: "poet",
  objective: "write poetry",
  instructions: [
    "Write in the specified poetic form",
    "Use vivid imagery and emotional language",
    "Follow poetic conventions and rhythm"
  ],
  output: [
    "Complete poem in specified form",
    "Appropriate line breaks and structure",
    "Rich imagery and emotional depth"
  ],
  temperature: 0.8,
  maxTokens: 1000
};
```

#### Coding Templates
```typescript
export const CodeGenerationTemplate = {
  role: "senior software engineer",
  objective: "write clean, functional code",
  instructions: [
    "Write clean, readable code",
    "Include proper error handling",
    "Add appropriate comments and documentation",
    "Follow language-specific best practices"
  ],
  output: [
    "Complete, functional code",
    "Proper error handling",
    "Clear documentation",
    "Follows best practices"
  ],
  temperature: 0.3,
  maxTokens: 2000
};

export const DebuggingTemplate = {
  role: "debugging expert",
  objective: "identify and fix code issues",
  instructions: [
    "Analyze code for bugs and issues",
    "Identify root causes of problems",
    "Provide corrected code solutions",
    "Explain the debugging process"
  ],
  output: [
    "Identified issues and their causes",
    "Step-by-step debugging process",
    "Corrected code with explanations",
    "Prevention strategies"
  ],
  temperature: 0.2,
  maxTokens: 1500
};
```

#### Analysis Templates
```typescript
export const DocumentAnalysisTemplate = {
  role: "document analyst",
  objective: "analyze and extract information from documents",
  instructions: [
    "Read and understand document content",
    "Extract key information accurately",
    "Identify document type and purpose",
    "Provide structured analysis"
  ],
  output: [
    "Document summary and key points",
    "Extracted metadata and information",
    "Document classification",
    "Structured analysis results"
  ],
  temperature: 0.2,
  maxTokens: 2000
};

export const AudioTranscriptionTemplate = {
  role: "audio transcription specialist",
  objective: "transcribe audio content accurately",
  instructions: [
    "Listen carefully to audio content",
    "Transcribe speech accurately",
    "Maintain proper punctuation and formatting",
    "Identify speakers when possible"
  ],
  output: [
    "Accurate transcription of audio",
    "Proper punctuation and formatting",
    "Speaker identification where possible",
    "Timestamp markers if needed"
  ],
  temperature: 0.1,
  maxTokens: 3000
};
```

### 3. Tool Integration (`src/stimulus/tools/`)

#### PDF Tools
```typescript
export const PDFTools = {
  extractText: (filePath: string) => Promise<string>,
  extractMetadata: (filePath: string) => Promise<PDFMetadata>,
  identifyDocumentType: (content: string) => Promise<string>,
  analyzeStructure: (content: string) => Promise<DocumentStructure>
};
```

#### Audio Tools
```typescript
export const AudioTools = {
  transcribe: (filePath: string) => Promise<string>,
  identifyLanguage: (audioPath: string) => Promise<string>,
  extractSpeakerInfo: (audioPath: string) => Promise<SpeakerInfo[]>,
  analyzeAudioQuality: (audioPath: string) => Promise<AudioQuality>
};
```

#### Image Tools
```typescript
export const ImageTools = {
  analyzeImage: (filePath: string) => Promise<ImageAnalysis>,
  extractText: (filePath: string) => Promise<string>,
  identifyObjects: (filePath: string) => Promise<ObjectDetection[]>,
  analyzeComposition: (filePath: string) => Promise<CompositionAnalysis>
};
```

### 4. Caching Infrastructure (`src/evaluation/caching/`)

#### Cache Service
```typescript
export class EvaluationCache {
  constructor(evaluationId: string);
  
  // Generic file caching
  async getCachedFile<T>(key: string, fetch: () => Promise<T>): Promise<T>;
  
  // Model response caching
  async getCachedModelResponse(
    model: ModelDetails, 
    stimulusId: string, 
    fetch: () => Promise<ModelResponse>
  ): Promise<ModelResponse>;
  
  // Score caching
  async getCachedScore(
    model: ModelDetails, 
    stimulusId: string, 
    scoreType: string, 
    fetch: () => Promise<any>
  ): Promise<any>;
  
  // External data caching
  async getCachedExternalData(
    dataType: string, 
    identifier: string, 
    fetch: () => Promise<string>
  ): Promise<string>;
}
```

## 📝 Script Examples

### Simple Creative Writing Test
```typescript
// scripts/creative/frankenstein.ts
import { LiteraryAnalysisTemplate } from "../../src/stimulus/templates/creative-templates.js";
import { SimpleEvaluation } from "../../src/evaluation/strategies/simple-evaluation.js";
import { Stimulus } from "../../src/stimulus/stimulus.js";

export async function frankensteinTest(models: ModelDetails[]) {
  const stimulus = new Stimulus({
    ...LiteraryAnalysisTemplate,
    systemContext: "Focus on Mary Shelley's Frankenstein novel"
  });
  
  const evaluation = new SimpleEvaluation(
    stimulus,
    models,
    "Who is the monster in Mary Shelley's Frankenstein? Explain your reasoning."
  );
  
  return await evaluation.run();
}
```

### Multi-Language Code Generation Matrix
```typescript
// scripts/coding/multi-language-matrix.ts
import { CodeGenerationTemplate } from "../../src/stimulus/templates/coding-templates.js";
import { MatrixEvaluation } from "../../src/evaluation/strategies/matrix-evaluation.js";
import { Stimulus } from "../../src/stimulus/stimulus.js";

export async function multiLanguageMatrixTest(models: ModelDetails[]) {
  const stimulus = new Stimulus(CodeGenerationTemplate);
  
  const dimensions = {
    language: ['typescript', 'python', 'javascript', 'go'],
    complexity: ['simple', 'medium', 'complex'],
    domain: ['api', 'data-processing', 'web-app', 'cli-tool']
  };
  
  const promptTemplate = (dims: any) => 
    `Write a ${dims.complexity} ${dims.language} ${dims.domain} that...`;
  
  const evaluation = new MatrixEvaluation(
    stimulus,
    models,
    dimensions,
    promptTemplate
  );
  
  return await evaluation.run();
}
```

### Batch PDF Analysis
```typescript
// scripts/analysis/batch-pdf-analysis.ts
import { DocumentAnalysisTemplate } from "../../src/stimulus/templates/analysis-templates.js";
import { BatchEvaluation } from "../../src/evaluation/strategies/batch-evaluation.js";
import { PDFTools } from "../../src/stimulus/tools/pdf-tools.js";
import { Stimulus } from "../../src/stimulus/stimulus.js";

export async function batchPDFAnalysis(models: ModelDetails[], pdfFiles: string[]) {
  const stimulus = new Stimulus({
    ...DocumentAnalysisTemplate,
    tools: { pdf: PDFTools }
  });
  
  const inputProcessor = async (filePath: string) => {
    const content = await PDFTools.extractText(filePath);
    return `Analyze this PDF document: ${filePath}\n\nContent:\n${content}`;
  };
  
  const evaluation = new BatchEvaluation(
    stimulus,
    models,
    pdfFiles,
    inputProcessor
  );
  
  return await evaluation.run();
}
```

## 🚀 Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
**Goal**: Establish evaluation framework and stimulus system

#### Tasks
1. **Create evaluation strategies**
   - SimpleEvaluation
   - CodeGenerationEvaluation
   - MatrixEvaluation
   - BatchEvaluation

2. **Create stimulus templates**
   - Generic creative templates
   - Generic coding templates
   - Generic analysis templates

3. **Implement caching system**
   - File caching
   - Model response caching
   - Score caching

4. **Create tool integrations**
   - PDF tools
   - Audio tools
   - Image tools

#### Deliverables
- `src/evaluation/strategies/` - All evaluation strategies
- `src/stimulus/templates/` - Generic stimulus templates
- `src/evaluation/caching/` - Caching infrastructure
- `src/stimulus/tools/` - Tool integrations
- Comprehensive test suite

### Phase 2: Script Migration (Week 2)
**Goal**: Move specific tests to scripts/ and update to use infrastructure

#### Tasks
1. **Reorganize scripts directory**
   - Create subdirectories by test type
   - Move specific implementations from src/ to scripts/

2. **Update scripts to use infrastructure**
   - Use stimulus templates
   - Use evaluation strategies
   - Use caching system

3. **Create example compositions**
   - Simple evaluation examples
   - Matrix evaluation examples
   - Batch evaluation examples
   - Complex pipeline examples

#### Deliverables
- Reorganized `scripts/` directory
- Updated scripts using infrastructure
- Example compositions
- Documentation for script patterns

### Phase 3: Advanced Features (Week 3)
**Goal**: Add advanced evaluation capabilities

#### Tasks
1. **Complex pipeline system**
   - Multi-step evaluation pipelines
   - Conditional evaluation steps
   - Result aggregation

2. **Analysis and reporting**
   - Result analysis tools
   - Report generation
   - Comparison tools

3. **CLI enhancements**
   - Evaluation management commands
   - Result viewing commands
   - Script execution commands

#### Deliverables
- `src/evaluation/pipeline/complex-pipeline.ts`
- `src/evaluation/analysis/` - Analysis tools
- Enhanced CLI commands
- Advanced reporting capabilities

### Phase 4: Documentation & Polish (Week 4)
**Goal**: Complete documentation and polish the system

#### Tasks
1. **Comprehensive documentation**
   - Architecture overview
   - User guides
   - API documentation
   - Example documentation

2. **Performance optimization**
   - Caching improvements
   - Evaluation optimization
   - Memory management

3. **Final testing**
   - Integration tests
   - Performance tests
   - End-to-end tests

#### Deliverables
- Complete documentation suite
- Performance optimizations
- Comprehensive test coverage
- Migration guide

## 🎯 Success Criteria

### Phase 1 Success
- [ ] All evaluation strategies implemented and tested
- [ ] Stimulus templates created and validated
- [ ] Caching system working effectively
- [ ] Tool integrations functional

### Phase 2 Success
- [ ] Scripts reorganized and using infrastructure
- [ ] Example compositions working
- [ ] Clear patterns for script creation
- [ ] Documentation for script patterns

### Phase 3 Success
- [ ] Complex pipelines working
- [ ] Analysis and reporting tools functional
- [ ] CLI enhancements complete
- [ ] Advanced features documented

### Phase 4 Success
- [ ] Comprehensive documentation complete
- [ ] Performance optimized
- [ ] All tests passing
- [ ] System ready for production use

## 🔄 Migration Strategy

### From Current State
1. **Move specific implementations** from `src/stimulus/` to `scripts/`
2. **Create generic templates** in `src/stimulus/templates/`
3. **Focus on evaluation infrastructure** in `src/evaluation/`
4. **Reorganize scripts** by test type
5. **Update documentation** to reflect new structure

### Backward Compatibility
- Existing scripts continue to work during migration
- Gradual migration approach
- Clear migration path for each component

## 📚 Documentation Structure

### Architecture Documentation
- **Overview**: High-level architecture explanation
- **Evaluation Framework**: How evaluation strategies work
- **Stimulus System**: How stimulus templates work
- **Caching System**: How caching infrastructure works

### User Guides
- **Getting Started**: Quick start guide
- **Creating Evaluations**: How to create new evaluations
- **Writing Scripts**: How to write test scripts
- **Best Practices**: Recommended patterns and practices

### API Documentation
- **Evaluation Strategies**: API reference for strategies
- **Stimulus Templates**: API reference for templates
- **Caching API**: API reference for caching
- **CLI Reference**: Command-line interface reference

### Example Documentation
- **Creative Writing**: Examples of creative writing tests
- **Code Generation**: Examples of code generation tests
- **Analysis Tasks**: Examples of analysis tests
- **Complex Evaluations**: Examples of complex evaluation compositions

## 🎉 Benefits of This Architecture

### 1. **Clear Separation of Concerns**
- Infrastructure vs. specific implementations
- Reusable components vs. one-off tests
- Generic templates vs. specific use cases

### 2. **High Reusability**
- Stimulus templates can be used in multiple tests
- Evaluation strategies can be composed in different ways
- Tool integrations work across different test types

### 3. **Easy Exploration**
- Simple to create new test combinations
- Clear patterns for different test types
- Infrastructure handles complexity

### 4. **Maintainability**
- Infrastructure changes don't affect specific tests
- Clear upgrade path for components
- Easy to add new capabilities

### 5. **Scalability**
- Complex evaluations compose simple building blocks
- Easy to add new evaluation strategies
- Simple to add new stimulus templates

This revised architecture provides a solid foundation for building and exploring AI model evaluations while maintaining clear separation between infrastructure and specific test implementations.
