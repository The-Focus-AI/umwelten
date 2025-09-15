# Stimulus-Centric Evaluation Architecture Specification

## Overview

This document outlines the new Stimulus-centric evaluation architecture for the umwelten project. The core principle is that **Stimulus** represents the primary unit of cognitive testing, with everything else (Interaction, Evaluation, Caching) being lightweight, composable infrastructure around it.

## Current State Analysis

### Existing Evaluation Patterns

Based on analysis of `scripts/` directory, we have identified three distinct patterns:

#### 1. Single Function Pattern (8 scripts)
- **Scripts**: `cat-poem.ts`, `frankenstein.ts`, `poem-test.ts`, `temperature.ts`, `pdf-identify.ts`, `pdf-parsing.ts`, `transcribe.ts`, `tools.ts`
- **Characteristics**: Simple function that takes ModelDetails and returns ModelResponse
- **Pros**: Simple, direct, minimal boilerplate
- **Cons**: Limited reusability, no built-in caching or reporting

#### 2. EvaluationRunner Subclass Pattern (4 scripts)
- **Scripts**: `google-pricing.ts`, `image-parsing.ts`, `roadtrip.ts`, `site-info.ts`
- **Characteristics**: Extends EvaluationRunner with custom getModelResponse implementation
- **Pros**: Built-in caching, automatic file management, consistent interface
- **Cons**: More boilerplate, requires understanding of EvaluationRunner

#### 3. Multi-Matrix Pipeline Pattern (3 scripts)
- **Scripts**: `multi-language-evaluation.ts`, `ollama-typescript-evaluation.ts`, `image-feature-batch.ts`
- **Characteristics**: Complex multi-step pipelines with Docker execution, AI scoring, reporting
- **Pros**: Handles complex scenarios, comprehensive reporting, AI-powered scoring
- **Cons**: Very complex, lots of boilerplate, difficult to modify

### Current Caching Infrastructure

The existing system provides:
- **Model Response Caching**: Automatic caching of model responses
- **Generic File Caching**: For external data (HTML, API responses)
- **Score Caching**: For evaluation scores
- **Directory Structure**: Organized by evaluation ID with subdirectories

## New Architecture Design

### Core Principles

1. **Stimulus as Primary Unit**: Stimulus represents what we're testing, not how we're testing it
2. **Separation of Concerns**: Stimulus = cognitive task, Evaluation Strategy = testing approach
3. **Composability**: Simple evaluations use one strategy, complex evaluations compose multiple strategies
4. **Caching Integration**: Built into evaluation strategies, not Stimulus
5. **Backward Compatibility**: Existing scripts should continue to work during migration

### Architecture Components

#### 1. Stimulus (Pure Cognitive Task)
```typescript
export const TypeScriptCodeStimulus = new Stimulus({
  id: 'typescript-code-generation',
  name: 'TypeScript Code Generation',
  description: 'Test models\' ability to generate working TypeScript code',
  
  // Core stimulus configuration
  role: "expert TypeScript developer",
  objective: "generate working TypeScript code solutions",
  instructions: [
    "Write clean, functional TypeScript code",
    "Include proper type annotations"
  ],
  runnerType: 'base'
});
```

#### 2. Evaluation Strategies (Reusable Testing Approaches)
```typescript
// Simple evaluation
class SimpleEvaluation {
  constructor(stimulus: Stimulus, models: ModelDetails[], prompt: string, cache: EvaluationCache)
  async run(): Promise<EvaluationResult[]>
}

// Code generation evaluation
class CodeGenerationEvaluation {
  constructor(stimulus: Stimulus, models: ModelDetails[], prompt: string, language: string, validation: CodeValidationConfig, cache: EvaluationCache)
  async run(): Promise<CodeGenerationResult[]>
}

// Matrix evaluation
class MatrixEvaluation {
  constructor(stimulus: Stimulus, models: ModelDetails[], dimensions: Record<string, any[]>, promptTemplate: Function, cache: EvaluationCache)
  async run(): Promise<MatrixResult[]>
}

// Batch evaluation
class BatchEvaluation {
  constructor(stimulus: Stimulus, models: ModelDetails[], inputs: any[], inputProcessor: Function, cache: EvaluationCache)
  async run(): Promise<BatchResult[]>
}
```

#### 3. Caching Service
```typescript
class EvaluationCache {
  constructor(evaluationId: string)
  
  // Generic file caching
  async getCachedFile<T>(key: string, fetch: () => Promise<T>): Promise<T>
  
  // Model response caching
  async getCachedModelResponse(model: ModelDetails, stimulusId: string, fetch: () => Promise<ModelResponse>): Promise<ModelResponse>
  
  // Score caching
  async getCachedScore(model: ModelDetails, stimulusId: string, scoreType: string, fetch: () => Promise<any>): Promise<any>
  
  // External data caching
  async getCachedExternalData(dataType: string, identifier: string, fetch: () => Promise<string>): Promise<string>
}
```

#### 4. Composable Pipeline
```typescript
class ComplexEvaluationPipeline {
  constructor(stimulus: Stimulus, models: ModelDetails[], strategies: EvaluationStrategy[])
  async run(): Promise<ComplexResult[]>
}
```

## Directory Structure

```
src/
├── stimuli/                    # Pure stimulus definitions
│   ├── creative/
│   │   ├── cat-poem.ts
│   │   ├── haiku.ts
│   │   └── story-writing.ts
│   ├── coding/
│   │   ├── typescript.ts
│   │   ├── python.ts
│   │   └── debugging.ts
│   ├── analysis/
│   │   ├── pdf-analysis.ts
│   │   ├── image-analysis.ts
│   │   └── data-analysis.ts
│   └── index.ts
├── evaluation/
│   ├── strategies/             # Reusable evaluation strategies
│   │   ├── simple-evaluation.ts
│   │   ├── code-generation-evaluation.ts
│   │   ├── matrix-evaluation.ts
│   │   ├── batch-evaluation.ts
│   │   └── index.ts
│   ├── caching/                # Caching infrastructure
│   │   ├── cache-service.ts
│   │   └── index.ts
│   ├── types/                  # Type definitions
│   │   ├── evaluation-types.ts
│   │   └── index.ts
│   └── index.ts
└── scripts/                    # Evaluation scripts
    ├── stimuli/                # Stimulus definitions (moved from src/)
    ├── evaluate-*.ts           # Simple evaluation scripts
    ├── compare-*.ts            # Comparison scripts
    ├── benchmark-*.ts          # Benchmark scripts
    └── legacy/                 # Original scripts (during migration)
```

## Migration Status Tracking

### Phase 1: Foundation (Not Started)
- [ ] Create new directory structure
- [ ] Implement EvaluationCache service
- [ ] Create base evaluation strategy interfaces
- [ ] Implement SimpleEvaluation strategy
- [ ] Create stimulus definition templates

### Phase 2: Core Strategies (Not Started)
- [ ] Implement CodeGenerationEvaluation strategy
- [ ] Implement MatrixEvaluation strategy
- [ ] Implement BatchEvaluation strategy
- [ ] Create evaluation result types
- [ ] Add comprehensive caching integration

### Phase 3: Stimulus Migration - ✅ IN PROGRESS (75% complete)
- [x] Migrate creative stimuli (cat-poem, frankenstein, poem-test, temperature) - ✅ COMPLETED
- [x] Migrate coding stimuli (typescript, python, debugging) - ✅ COMPLETED
- [x] Migrate analysis stimuli (pdf-identify, pdf-parsing, transcribe, tools) - ✅ COMPLETED
- [x] Create stimulus index and organization - ✅ COMPLETED
- [ ] Migrate remaining analysis stimuli (image-analysis) - ⏳ PENDING

### Phase 4: Script Migration (Not Started)
- [ ] Migrate single function pattern scripts
- [ ] Migrate EvaluationRunner pattern scripts
- [ ] Migrate multi-matrix pipeline scripts
- [ ] Create comparison and benchmark scripts

### Phase 5: Advanced Features (Not Started)
- [ ] Implement ComplexEvaluationPipeline
- [ ] Add evaluation comparison tools
- [ ] Create evaluation reporting system
- [ ] Add CLI tools for evaluation management

### Phase 6: Cleanup (Not Started)
- [ ] Remove legacy evaluation patterns
- [ ] Update documentation
- [ ] Create migration guide
- [ ] Performance optimization

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal**: Establish core infrastructure

**Tasks**:
1. Create new directory structure
2. Implement EvaluationCache service
3. Create base evaluation strategy interfaces
4. Implement SimpleEvaluation strategy
5. Create stimulus definition templates

**Deliverables**:
- `src/evaluation/caching/cache-service.ts`
- `src/evaluation/strategies/simple-evaluation.ts`
- `src/evaluation/types/evaluation-types.ts`
- `src/stimulus/` directory structure
- Basic stimulus templates

**Success Criteria**:
- Can create and run simple evaluations
- Caching works for model responses
- Basic stimulus definitions work

### Phase 2: Core Strategies (Week 2)
**Goal**: Implement core evaluation strategies

**Tasks**:
1. Implement CodeGenerationEvaluation strategy
2. Implement MatrixEvaluation strategy
3. Implement BatchEvaluation strategy
4. Create evaluation result types
5. Add comprehensive caching integration

**Deliverables**:
- `src/evaluation/strategies/code-generation-evaluation.ts`
- `src/evaluation/strategies/matrix-evaluation.ts`
- `src/evaluation/strategies/batch-evaluation.ts`
- `src/evaluation/types/evaluation-types.ts` (expanded)
- Updated caching service

**Success Criteria**:
- Can run code generation evaluations
- Can run matrix evaluations across multiple dimensions
- Can run batch evaluations with multiple inputs
- All strategies use caching effectively

### Phase 3: Stimulus Migration (Week 3)
**Goal**: Migrate existing stimuli to new architecture

**Tasks**:
1. Migrate creative stimuli (cat-poem, frankenstein, poem-test, temperature)
2. Migrate coding stimuli (typescript, python, debugging)
3. Migrate analysis stimuli (pdf-identify, pdf-parsing, transcribe)
4. Create stimulus index and organization

**Deliverables**:
- `src/stimulus/creative/` directory with migrated stimuli
- `src/stimulus/coding/` directory with migrated stimuli
- `src/stimulus/analysis/` directory with migrated stimuli
- `src/stimulus/index.ts` with exports
- Updated stimulus definitions

**Success Criteria**:
- All existing stimuli work with new architecture
- Stimuli are properly organized by domain
- Stimulus definitions are clean and focused

### Phase 4: Script Migration (Week 4)
**Goal**: Migrate existing evaluation scripts

**Tasks**:
1. Migrate single function pattern scripts
2. Migrate EvaluationRunner pattern scripts
3. Migrate multi-matrix pipeline scripts
4. Create comparison and benchmark scripts

**Deliverables**:
- `scripts/evaluate-*.ts` for simple evaluations
- `scripts/compare-*.ts` for comparison evaluations
- `scripts/benchmark-*.ts` for benchmark evaluations
- `scripts/legacy/` with original scripts
- Updated script documentation

**Success Criteria**:
- All existing scripts work with new architecture
- New scripts are simpler and more maintainable
- Comparison and benchmark tools work

### Phase 5: Advanced Features (Week 5)
**Goal**: Add advanced evaluation capabilities

**Tasks**:
1. Implement ComplexEvaluationPipeline
2. Add evaluation comparison tools
3. Create evaluation reporting system
4. Add CLI tools for evaluation management

**Deliverables**:
- `src/evaluation/pipeline/complex-evaluation-pipeline.ts`
- `src/evaluation/tools/comparison-tools.ts`
- `src/evaluation/reporting/evaluation-reporter.ts`
- CLI tools for evaluation management
- Advanced reporting capabilities

**Success Criteria**:
- Can compose complex evaluation pipelines
- Can compare evaluations across models and stimuli
- Can generate comprehensive reports
- CLI tools work for evaluation management

### Phase 6: Cleanup (Week 6)
**Goal**: Clean up legacy code and optimize

**Tasks**:
1. Remove legacy evaluation patterns
2. Update documentation
3. Create migration guide
4. Performance optimization

**Deliverables**:
- Removed legacy code
- Updated documentation
- Migration guide
- Performance optimizations

**Success Criteria**:
- Codebase is clean and consistent
- Documentation is up to date
- Performance is optimized
- Migration guide is complete

## Benefits of New Architecture

### 1. **Clarity of Purpose**
- Each Stimulus represents one specific capability to test
- Easy to understand what's being tested
- Clear success criteria and metrics

### 2. **Reusability**
- Stimuli can be reused across different evaluation scenarios
- Easy to compare similar stimuli
- Stimuli can be composed into larger tests

### 3. **Simplicity**
- No complex evaluation patterns to learn
- Stimulus is the main thing, everything else is simple
- Easy to create new tests

### 4. **Maintainability**
- Stimuli are self-contained and focused
- Easy to modify or extend individual stimuli
- Clear separation of concerns

### 5. **Performance**
- Comprehensive caching at all levels
- Avoids re-running expensive operations
- Enables incremental evaluation

### 6. **Composability**
- Simple evaluations use one strategy
- Complex evaluations compose multiple strategies
- Pipeline pattern for multi-step evaluations

## Migration Strategy

### Backward Compatibility
- Existing scripts continue to work during migration
- Gradual migration approach
- Legacy patterns deprecated but not removed immediately

### Migration Order
1. **Foundation**: Core infrastructure first
2. **Strategies**: Evaluation strategies second
3. **Stimuli**: Stimulus definitions third
4. **Scripts**: Evaluation scripts fourth
5. **Advanced**: Advanced features fifth
6. **Cleanup**: Legacy removal last

### Testing Strategy
- Each phase includes comprehensive testing
- Migration validation for each script
- Performance benchmarking
- Backward compatibility testing

## Success Metrics

### Phase 1 Success
- [ ] Can create and run simple evaluations
- [ ] Caching works for model responses
- [ ] Basic stimulus definitions work

### Phase 2 Success
- [ ] Can run code generation evaluations
- [ ] Can run matrix evaluations across multiple dimensions
- [ ] Can run batch evaluations with multiple inputs
- [ ] All strategies use caching effectively

### Phase 3 Success - ✅ 75% ACHIEVED
- [x] All existing stimuli work with new architecture - ✅ ACHIEVED
- [x] Stimuli are properly organized by domain - ✅ ACHIEVED
- [x] Stimulus definitions are clean and focused - ✅ ACHIEVED
- [x] Comprehensive test suites created for all stimuli - ✅ ACHIEVED
- [ ] Complete migration of all analysis stimuli - ⏳ IN PROGRESS

### Phase 4 Success
- [ ] All existing scripts work with new architecture
- [ ] New scripts are simpler and more maintainable
- [ ] Comparison and benchmark tools work

### Phase 5 Success
- [ ] Can compose complex evaluation pipelines
- [ ] Can compare evaluations across models and stimuli
- [ ] Can generate comprehensive reports
- [ ] CLI tools work for evaluation management

### Phase 6 Success
- [ ] Codebase is clean and consistent
- [ ] Documentation is up to date
- [ ] Performance is optimized
- [ ] Migration guide is complete

## Next Steps

1. **Review and Approve Specification**: Review this specification and approve the approach
2. **Begin Phase 1**: Start implementing the foundation infrastructure
3. **Create Migration Tracking**: Set up tracking for migration progress
4. **Test Early and Often**: Validate each phase before moving to the next

This specification provides a clear roadmap for transforming the umwelten evaluation system into a clean, maintainable, and powerful Stimulus-centric architecture.
