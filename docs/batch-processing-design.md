# Batch Processing Design for CLI Evaluation System

## Overview

This document outlines the design for adding batch processing capabilities to the `umwelten eval` CLI command, enabling efficient evaluation across multiple files, models, and parameters.

## Current Batch Processing Patterns

### 1. Image Feature Batch (`image-feature-batch.ts`)
```typescript
// Pattern: Multiple files × Multiple models
for (const model of models) {
  for (const image of images) {
    await evaluate(imageFeatureExtract(imagePath, model), evaluationId, image, model);
  }
}
```

### 2. Multi-Language Evaluation (`multi-language-evaluation.ts`)
```typescript
// Pattern: Multiple languages × Multiple models × Pipeline stages
for (const languageConfig of languagesToEvaluate) {
  for (const model of OLLAMA_MODELS) {
    // PASS 1: Generate responses
    // PASS 2: Extract code
    // PASS 3: Run Docker
    // PASS 4: Score results
  }
}
```

## Proposed CLI Batch Processing Features

### 1. File-Based Batch Processing

#### Command Structure
```bash
# Batch process multiple files
umwelten eval batch \
  --prompt "Analyze this image and extract features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --files "input/images/*.jpg" \
  --id "image-batch-analysis" \
  --concurrent

# Batch process with directory scanning
umwelten eval batch \
  --prompt "Process this document" \
  --models "google:gemini-2.0-flash" \
  --directory "input/documents" \
  --file-pattern "*.pdf" \
  --id "document-batch" \
  --concurrent
```

#### Implementation
```typescript
interface BatchConfig extends EvaluationConfig {
  files?: string[];           // Explicit file list
  directory?: string;         // Directory to scan
  filePattern?: string;       // Glob pattern (e.g., "*.jpg")
  recursive?: boolean;        // Scan subdirectories
  maxFiles?: number;          // Limit number of files
  fileIdStrategy?: 'filename' | 'path' | 'hash'; // How to generate file IDs
}
```

### 2. Parameter-Based Batch Processing

#### Command Structure
```bash
# Batch with different temperatures
umwelten eval batch \
  --prompt "Write a creative story" \
  --models "ollama:gemma3:27b" \
  --batch-temperatures "0.1,0.5,1.0,2.0" \
  --id "temperature-study"

# Batch with different system prompts
umwelten eval batch \
  --prompt "Explain quantum physics" \
  --models "google:gemini-2.0-flash" \
  --batch-system-prompts "You are a physicist,You are a teacher,You are a student" \
  --id "perspective-study"
```

#### Implementation
```typescript
interface ParameterBatchConfig extends EvaluationConfig {
  batchTemperatures?: number[];
  batchSystemPrompts?: string[];
  batchPrompts?: string[];
  batchModels?: string[][];  // Groups of models to test together
  parameterCombinations?: boolean; // Test all combinations
}
```

### 3. Pipeline-Based Batch Processing

#### Command Structure
```bash
# Multi-stage pipeline for language evaluation
umwelten eval pipeline \
  --stages "generate,extract,docker,score" \
  --prompt "Write a TypeScript function that generates 1000 random names" \
  --models "ollama:gpt-oss:20b,ollama:gemma3:27b" \
  --languages "typescript,python,javascript" \
  --id "multi-language-pipeline"

# Custom pipeline stages
umwelten eval pipeline \
  --stages "generate,validate,optimize" \
  --stage-config "validate:--schema-file schemas/code.json" \
  --stage-config "optimize:--temperature 0.1" \
  --id "custom-pipeline"
```

#### Implementation
```typescript
interface PipelineConfig extends EvaluationConfig {
  stages: string[];           // Pipeline stages to execute
  stageConfig?: Record<string, string>; // Stage-specific config
  languages?: string[];       // For multi-language pipelines
  continueOnError?: boolean;  // Continue pipeline on stage failure
  parallelStages?: boolean;   // Run independent stages in parallel
}
```

## Implementation Strategy

### Phase 1: File-Based Batch Processing

1. **Add `batch` subcommand to `eval`**
   ```typescript
   const batchCommand = new Command('batch')
     .description('Run evaluations across multiple files')
     .option('--files <files>', 'Comma-separated list of files or glob patterns')
     .option('--directory <dir>', 'Directory to scan for files')
     .option('--file-pattern <pattern>', 'File pattern (e.g., "*.jpg")')
     .option('--recursive', 'Scan subdirectories recursively')
     .option('--max-files <number>', 'Maximum number of files to process')
   ```

2. **File Discovery and Processing**
   ```typescript
   async function discoverFiles(config: BatchConfig): Promise<string[]> {
     const files: string[] = [];
     
     if (config.files) {
       // Expand glob patterns
       for (const pattern of config.files) {
         const matches = await glob(pattern, { 
           cwd: process.cwd(),
           absolute: true 
         });
         files.push(...matches);
       }
     }
     
     if (config.directory) {
       const pattern = config.filePattern || '*';
       const matches = await glob(`${config.directory}/**/${pattern}`, {
         cwd: process.cwd(),
         absolute: true,
         ignore: config.recursive ? [] : ['**/node_modules/**']
       });
       files.push(...matches);
     }
     
     return files.slice(0, config.maxFiles || files.length);
   }
   ```

3. **Batch Execution**
   ```typescript
   async function runBatchEvaluation(config: BatchConfig): Promise<BatchResult> {
     const files = await discoverFiles(config);
     const results: FileResult[] = [];
     
     for (const file of files) {
       const fileConfig = { ...config, attachments: [file] };
       const result = await runEvaluation(fileConfig);
       results.push({ file, result });
     }
     
     return { files, results };
   }
   ```

### Phase 2: Parameter-Based Batch Processing

1. **Parameter Expansion**
   ```typescript
   function expandParameterCombinations(config: ParameterBatchConfig): EvaluationConfig[] {
     const combinations: EvaluationConfig[] = [];
     
     const temperatures = config.batchTemperatures || [config.temperature || 0.7];
     const systemPrompts = config.batchSystemPrompts || [config.systemPrompt];
     const prompts = config.batchPrompts || [config.prompt];
     
     for (const temp of temperatures) {
       for (const sysPrompt of systemPrompts) {
         for (const prompt of prompts) {
           combinations.push({
             ...config,
             temperature: temp,
             systemPrompt: sysPrompt,
             prompt
           });
         }
       }
     }
     
     return combinations;
   }
   ```

### Phase 3: Pipeline-Based Batch Processing

1. **Pipeline Stage Definition**
   ```typescript
   interface PipelineStage {
     name: string;
     execute: (input: any, config: any) => Promise<any>;
     dependencies?: string[];
     parallel?: boolean;
   }
   
   const PIPELINE_STAGES: Record<string, PipelineStage> = {
     generate: {
       name: 'generate',
       execute: async (input, config) => {
         return await runEvaluation(config);
       }
     },
     extract: {
       name: 'extract',
       dependencies: ['generate'],
       execute: async (input, config) => {
         return await extractCodeFromResponses(input);
       }
     },
     docker: {
       name: 'docker',
       dependencies: ['extract'],
       execute: async (input, config) => {
         return await runCodeInDocker(input);
       }
     },
     score: {
       name: 'score',
       dependencies: ['docker'],
       execute: async (input, config) => {
         return await scoreResults(input);
       }
     }
   };
   ```

## CLI Command Examples

### File Batch Processing
```bash
# Process all images in a directory
umwelten eval batch \
  --prompt "Analyze this image and describe its features" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --directory "input/images" \
  --file-pattern "*.jpg" \
  --id "image-analysis-batch" \
  --concurrent \
  --max-concurrency 5

# Process specific files with different prompts
umwelten eval batch \
  --prompt "Extract text from this document" \
  --models "google:gemini-2.0-flash" \
  --files "doc1.pdf,doc2.pdf,doc3.pdf" \
  --id "document-extraction" \
  --ui
```

### Parameter Batch Processing
```bash
# Temperature study
umwelten eval batch \
  --prompt "Write a creative story about a robot" \
  --models "ollama:gemma3:27b" \
  --batch-temperatures "0.1,0.5,1.0,2.0" \
  --id "temperature-creativity-study"

# System prompt comparison
umwelten eval batch \
  --prompt "Explain machine learning" \
  --models "google:gemini-2.0-flash" \
  --batch-system-prompts "You are a professor,You are a student,You are a practitioner" \
  --id "perspective-comparison"
```

### Pipeline Batch Processing
```bash
# Multi-language code evaluation
umwelten eval pipeline \
  --stages "generate,extract,docker,score" \
  --prompt "Write a function that generates random names" \
  --models "ollama:gpt-oss:20b,ollama:gemma3:27b" \
  --languages "typescript,python,javascript" \
  --id "multi-language-evaluation" \
  --concurrent

# Custom pipeline with validation
umwelten eval pipeline \
  --stages "generate,validate,optimize" \
  --prompt "Create a JSON API response" \
  --models "google:gemini-2.0-flash" \
  --stage-config "validate:--schema-file schemas/api.json" \
  --stage-config "optimize:--temperature 0.1" \
  --id "api-generation-pipeline"
```

## Benefits

1. **Efficiency**: Process multiple files/models simultaneously
2. **Consistency**: Same evaluation logic across all items
3. **Scalability**: Handle large datasets efficiently
4. **Flexibility**: Support various batch processing patterns
5. **Integration**: Work with existing CLI features (UI, reporting, etc.)

## Implementation Priority

1. **Phase 1**: File-based batch processing (highest impact)
2. **Phase 2**: Parameter-based batch processing (medium impact)
3. **Phase 3**: Pipeline-based batch processing (complex but powerful)

## Migration Path

This design enables migration of existing batch scripts:
- `image-feature-batch.ts` → `umwelten eval batch`
- `multi-language-evaluation.ts` → `umwelten eval pipeline`
- Custom batch scripts → `umwelten eval batch` with custom parameters
