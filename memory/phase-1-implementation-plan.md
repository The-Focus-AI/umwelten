# Phase 1 Implementation Plan: Foundation

## Overview
Phase 1 establishes the core infrastructure for the new Stimulus-centric evaluation architecture. This phase focuses on creating the foundational components that will support all future development.

## Goals
- Create new directory structure
- Implement EvaluationCache service
- Create base evaluation strategy interfaces
- Implement SimpleEvaluation strategy
- Create stimulus definition templates

## Detailed Tasks

### Task 1.1: Create Directory Structure
**Estimated Time**: 30 minutes
**Dependencies**: None

**Actions**:
1. Create `src/stimulus/` directory with subdirectories:
   - `src/stimulus/creative/`
   - `src/stimulus/coding/`
   - `src/stimulus/analysis/`
2. Create `src/evaluation/strategies/` directory
3. Create `src/evaluation/caching/` directory
4. Create `src/evaluation/types/` directory
5. Create `scripts/legacy/` directory for migration

**Files to Create**:
```
src/stimulus/
├── creative/
├── coding/
├── analysis/
└── index.ts

src/evaluation/
├── strategies/
├── caching/
├── types/
└── index.ts

scripts/legacy/
```

**Validation**:
- [ ] All directories exist
- [ ] Index files are created
- [ ] Directory structure matches specification

### Task 1.2: Implement EvaluationCache Service
**Estimated Time**: 2 hours
**Dependencies**: Task 1.1

**Actions**:
1. Create `src/evaluation/caching/cache-service.ts`
2. Implement base EvaluationCache class
3. Add generic file caching method
4. Add model response caching method
5. Add score caching method
6. Add external data caching method
7. Add directory management methods
8. Create comprehensive tests

**Files to Create**:
- `src/evaluation/caching/cache-service.ts`
- `src/evaluation/caching/index.ts`
- `src/evaluation/caching/cache-service.test.ts`

**Key Methods**:
```typescript
class EvaluationCache {
  constructor(evaluationId: string)
  getWorkdir(): string
  async getCachedFile<T>(key: string, fetch: () => Promise<T>): Promise<T>
  async getCachedModelResponse(model: ModelDetails, stimulusId: string, fetch: () => Promise<ModelResponse>): Promise<ModelResponse>
  async getCachedScore(model: ModelDetails, stimulusId: string, scoreType: string, fetch: () => Promise<any>): Promise<any>
  async getCachedExternalData(dataType: string, identifier: string, fetch: () => Promise<string>): Promise<string>
}
```

**Validation**:
- [ ] All methods work correctly
- [ ] Caching prevents duplicate API calls
- [ ] File organization is correct
- [ ] Tests pass
- [ ] Error handling works

### Task 1.3: Create Evaluation Types
**Estimated Time**: 1 hour
**Dependencies**: Task 1.1

**Actions**:
1. Create `src/evaluation/types/evaluation-types.ts`
2. Define base evaluation strategy interface
3. Define evaluation result types
4. Define configuration types
5. Create comprehensive type definitions

**Files to Create**:
- `src/evaluation/types/evaluation-types.ts`
- `src/evaluation/types/index.ts`

**Key Types**:
```typescript
interface EvaluationStrategy {
  run(): Promise<EvaluationResult[]>
}

interface EvaluationResult {
  model: ModelDetails
  response: ModelResponse
  metadata: EvaluationMetadata
}

interface EvaluationMetadata {
  stimulusId: string
  evaluationId: string
  timestamp: Date
  duration: number
  cached: boolean
}
```

**Validation**:
- [ ] All types are properly defined
- [ ] Types are exported correctly
- [ ] TypeScript compilation succeeds
- [ ] Types are comprehensive

### Task 1.4: Implement SimpleEvaluation Strategy
**Estimated Time**: 2 hours
**Dependencies**: Task 1.2, Task 1.3

**Actions**:
1. Create `src/evaluation/strategies/simple-evaluation.ts`
2. Implement SimpleEvaluation class
3. Add caching integration
4. Add error handling
5. Create comprehensive tests
6. Add documentation

**Files to Create**:
- `src/evaluation/strategies/simple-evaluation.ts`
- `src/evaluation/strategies/index.ts`
- `src/evaluation/strategies/simple-evaluation.test.ts`

**Key Implementation**:
```typescript
export class SimpleEvaluation implements EvaluationStrategy {
  constructor(
    public stimulus: Stimulus,
    public models: ModelDetails[],
    public prompt: string,
    private cache: EvaluationCache
  ) {}

  async run(): Promise<EvaluationResult[]> {
    const results = [];
    
    for (const model of this.models) {
      const response = await this.cache.getCachedModelResponse(
        model,
        this.stimulus.id,
        async () => {
          const interaction = new Interaction(model, this.stimulus);
          interaction.addMessage({ role: 'user', content: this.prompt });
          return await interaction.execute();
        }
      );
      
      results.push({ model, response, metadata: {...} });
    }
    
    return results;
  }
}
```

**Validation**:
- [ ] SimpleEvaluation works correctly
- [ ] Caching integration works
- [ ] Error handling works
- [ ] Tests pass
- [ ] Documentation is complete

### Task 1.5: Create Stimulus Templates
**Estimated Time**: 1 hour
**Dependencies**: Task 1.1

**Actions**:
1. Create `src/stimulus/creative/cat-poem.ts`
2. Create `src/stimulus/coding/typescript.ts`
3. Create `src/stimulus/analysis/pdf-analysis.ts`
4. Create `src/stimulus/index.ts`
5. Add documentation and examples

**Files to Create**:
- `src/stimulus/creative/cat-poem.ts`
- `src/stimulus/coding/typescript.ts`
- `src/stimulus/analysis/pdf-analysis.ts`
- `src/stimulus/index.ts`

**Key Templates**:
```typescript
// src/stimulus/creative/cat-poem.ts
export const CatPoemStimulus = new Stimulus({
  id: 'cat-poem',
  name: 'Cat Poem Generation',
  description: 'Test models\' ability to write creative poetry about cats',
  
  role: "literary genius",
  objective: "write short poems about cats",
  temperature: 0.5,
  maxTokens: 200,
  runnerType: 'base'
});
```

**Validation**:
- [ ] Stimulus templates work correctly
- [ ] Stimuli are properly organized
- [ ] Index exports work
- [ ] Documentation is complete

### Task 1.6: Create Example Evaluation Script
**Estimated Time**: 1 hour
**Dependencies**: Task 1.4, Task 1.5

**Actions**:
1. Create `scripts/evaluate-cat-poem.ts`
2. Demonstrate SimpleEvaluation usage
3. Show caching in action
4. Add comprehensive documentation

**Files to Create**:
- `scripts/evaluate-cat-poem.ts`

**Key Implementation**:
```typescript
import { CatPoemStimulus } from '../src/stimulus/creative/cat-poem';
import { SimpleEvaluation } from '../src/evaluation/strategies/simple-evaluation';
import { EvaluationCache } from '../src/evaluation/caching/cache-service';

const models = [
  { name: 'gemma3:27b', provider: 'ollama' },
  { name: 'gemini-2.0-flash', provider: 'google' }
];

const cache = new EvaluationCache('cat-poem');
const evaluation = new SimpleEvaluation(
  CatPoemStimulus,
  models,
  "Write a short poem about a cat",
  cache
);

const results = await evaluation.run();
console.log('Cat poem evaluation results:', results);
```

**Validation**:
- [ ] Example script works correctly
- [ ] Caching works as expected
- [ ] Results are properly formatted
- [ ] Documentation is complete

### Task 1.7: Create Tests and Documentation
**Estimated Time**: 2 hours
**Dependencies**: All previous tasks

**Actions**:
1. Create comprehensive test suite
2. Add integration tests
3. Create usage documentation
4. Add migration guide
5. Update main README

**Files to Create**:
- `src/evaluation/caching/cache-service.test.ts`
- `src/evaluation/strategies/simple-evaluation.test.ts`
- `docs/evaluation-architecture.md`
- `docs/migration-guide.md`

**Validation**:
- [ ] All tests pass
- [ ] Integration tests work
- [ ] Documentation is complete
- [ ] Migration guide is helpful

## Success Criteria

### Functional Requirements
- [ ] Can create and run simple evaluations
- [ ] Caching works for model responses
- [ ] Basic stimulus definitions work
- [ ] Error handling works correctly
- [ ] All tests pass

### Non-Functional Requirements
- [ ] Code is well-documented
- [ ] TypeScript compilation succeeds
- [ ] Performance is acceptable
- [ ] Error messages are helpful
- [ ] Code follows project conventions

### Quality Requirements
- [ ] Code is maintainable
- [ ] Interfaces are clear
- [ ] Error handling is comprehensive
- [ ] Tests cover edge cases
- [ ] Documentation is complete

## Risk Mitigation

### Technical Risks
- **Risk**: Caching implementation is complex
- **Mitigation**: Start with simple caching, add complexity gradually
- **Risk**: TypeScript types are too complex
- **Mitigation**: Keep types simple, add complexity as needed

### Schedule Risks
- **Risk**: Tasks take longer than estimated
- **Mitigation**: Buffer time in estimates, prioritize core functionality
- **Risk**: Integration issues between components
- **Mitigation**: Test integration early and often

### Quality Risks
- **Risk**: Code quality suffers due to time pressure
- **Mitigation**: Maintain code review standards, don't skip tests
- **Risk**: Documentation is incomplete
- **Mitigation**: Document as you go, not at the end

## Dependencies

### External Dependencies
- Existing umwelten codebase
- TypeScript compilation
- Node.js runtime
- File system access

### Internal Dependencies
- Task 1.1 must complete before others
- Task 1.2 and 1.3 must complete before 1.4
- Task 1.4 and 1.5 must complete before 1.6
- All tasks must complete before 1.7

## Deliverables

### Code Deliverables
- [ ] `src/evaluation/caching/cache-service.ts`
- [ ] `src/evaluation/strategies/simple-evaluation.ts`
- [ ] `src/evaluation/types/evaluation-types.ts`
- [ ] `src/stimulus/` directory with templates
- [ ] `scripts/evaluate-cat-poem.ts`

### Test Deliverables
- [ ] `src/evaluation/caching/cache-service.test.ts`
- [ ] `src/evaluation/strategies/simple-evaluation.test.ts`
- [ ] Integration tests

### Documentation Deliverables
- [ ] `docs/evaluation-architecture.md`
- [ ] `docs/migration-guide.md`
- [ ] Updated README
- [ ] Code documentation

## Next Steps

After Phase 1 completion:
1. **Review Phase 1**: Validate all success criteria
2. **Plan Phase 2**: Begin planning core strategies implementation
3. **Gather Feedback**: Get feedback on Phase 1 implementation
4. **Iterate**: Make improvements based on feedback
5. **Begin Phase 2**: Start implementing core evaluation strategies

## Timeline

**Total Estimated Time**: 7.5 hours
**Target Completion**: End of Week 1
**Critical Path**: Tasks 1.1 → 1.2 → 1.4 → 1.6 → 1.7

**Daily Breakdown**:
- **Day 1**: Tasks 1.1, 1.2 (2.5 hours)
- **Day 2**: Tasks 1.3, 1.4 (3 hours)
- **Day 3**: Tasks 1.5, 1.6, 1.7 (2 hours)

This plan provides a clear roadmap for implementing Phase 1 of the new Stimulus-centric evaluation architecture.
