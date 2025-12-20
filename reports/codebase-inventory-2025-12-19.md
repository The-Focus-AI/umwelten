# Umwelten Codebase Inventory & Analysis

**Generated**: 2025-12-19

## Executive Summary

**Umwelten** is a comprehensive CLI tool for systematic AI model evaluation across multiple providers. The codebase consists of **159 TypeScript files** organized into modular components with a **stimulus-centric architecture** where the Stimulus is the primary unit of cognitive testing.

---

## 1. CORE MODELS & TYPES

### Primary Domain Models

| Model | Location | Purpose |
|-------|----------|---------|
| **Stimulus** | `src/stimulus/stimulus.ts` | Core evaluation unit - encapsulates role, objective, instructions, tools, model options |
| **Interaction** | `src/interaction/interaction.ts` | Manages conversations between users and models with stimulus context |
| **ModelDetails** | `src/cognition/types.ts` | Model identification - name, provider, costs, context length |
| **ModelResponse** | `src/cognition/types.ts` | Standardized response with content, metadata, token usage, costs |
| **EvaluationResult** | `src/evaluation/types/evaluation-types.ts` | Result of model evaluation with metadata |
| **CostBreakdown** | `src/costs/costs.ts` | Token usage and cost tracking |

### Key Classes

```
Stimulus
├── Properties: id, name, role, objective, instructions, output, examples
├── Tools: tools, toolInstructions, maxToolSteps
├── Model Options: temperature, maxTokens, topP, frequencyPenalty
├── Runner: runnerType ('base' | 'memory')
└── Methods: getPrompt(), setTools(), getModelOptions()

Interaction
├── Properties: messages, runner, modelDetails, stimulus, tools
└── Methods: generateText(), streamText(), generateObject(), streamObject()

BaseModelRunner
├── Methods: generateText(), streamText(), generateObject(), streamObject()
├── Features: Rate limiting, cost calculation, reasoning extraction
└── Vercel AI SDK integration
```

---

## 2. ARCHITECTURE & DIRECTORY STRUCTURE

```
src/ (159 files total)
├── cli/           # CLI commands (13 files)
│   ├── cli.ts     # Entry point - registers commands
│   ├── run.ts     # Single prompt evaluation
│   ├── eval.ts    # Batch evaluation workflow
│   ├── chat.ts    # Interactive chat
│   ├── models.ts  # List available models
│   └── tools.ts   # Tool demonstrations
│
├── cognition/     # Model runners (8 files)
│   ├── runner.ts        # BaseModelRunner
│   ├── smart_runner.ts  # Runner with hooks
│   ├── types.ts         # ModelDetails, ModelResponse
│   └── models.ts        # Model registry
│
├── evaluation/    # Evaluation system
│   ├── api.ts           # runEvaluation(), generateReport()
│   ├── base.ts          # Filesystem abstraction
│   ├── runner.ts        # EvaluationRunner
│   ├── strategies/      # Evaluation patterns
│   │   ├── simple-evaluation.ts      # Basic text generation
│   │   ├── batch-evaluation.ts       # Large-scale processing
│   │   ├── matrix-evaluation.ts      # Multi-dimensional testing
│   │   ├── code-generation-evaluation.ts  # Code gen + execution
│   │   └── complex-pipeline.ts       # Multi-stage workflows
│   ├── analysis/        # Result analysis (7 files)
│   └── caching/         # EvaluationCache service
│
├── interaction/   # Conversation management (1 file)
│   └── interaction.ts   # Interaction class
│
├── stimulus/      # Stimulus definitions
│   ├── stimulus.ts      # Base Stimulus class
│   ├── templates/       # Pre-built templates
│   ├── creative/        # Creative writing stimuli
│   ├── coding/          # Code generation stimuli
│   ├── analysis/        # Analysis stimuli
│   └── tools/           # Tool integrations
│
├── providers/     # Multi-provider support (6 files)
│   ├── index.ts         # Factory: getModel()
│   ├── base.ts          # BaseProvider interface
│   ├── google.ts        # Google Gemini
│   ├── openrouter.ts    # OpenRouter (GPT-4, Claude, etc.)
│   ├── ollama.ts        # Local Ollama
│   ├── lmstudio.ts      # LM Studio
│   └── github-models.ts # GitHub Models
│
├── memory/        # Stateful conversations (7 files)
│   ├── memory_store.ts      # InMemoryMemoryStore
│   ├── memory_runner.ts     # MemoryRunner with hooks
│   ├── extract_facts.ts     # Fact extraction
│   └── determine_operations.ts  # ADD/UPDATE/DELETE ops
│
├── mcp/           # Model Context Protocol
│   ├── client/          # MCPClient implementation
│   ├── server/          # MCP server
│   └── types/           # Transport abstractions
│
├── schema/        # Schema validation (8 files)
│   ├── dsl-parser.ts    # Simple DSL: "name, age int"
│   ├── zod-loader.ts    # Zod schema loading
│   ├── zod-converter.ts # Format conversion
│   └── manager.ts       # SchemaManager
│
├── costs/         # Cost tracking (2 files)
├── rate-limit/    # Rate limiting
├── ui/            # User interfaces
└── test-utils/    # Testing utilities
```

---

## 3. DATA FLOW & CONNECTIONS

### Primary Data Flow

```
User Input → CLI Commands → Evaluation API → Stimulus + ModelDetails
                                    ↓
                           Provider Factory → getModel()
                                    ↓
                           Create Interaction
                                    ↓
                           BaseModelRunner → Vercel AI SDK → LLM API
                                    ↓
                           ModelResponse → Cost Calculation
                                    ↓
                           Caching → Analysis → Report
```

### Key Integration Points

1. **CLI → Evaluation**: `cli/eval.ts` calls `evaluation/api.ts:runEvaluation()`
2. **Stimulus → Interaction**: `Interaction` wraps `Stimulus` for execution
3. **Provider Factory**: `providers/index.ts:getModel()` dispatches to providers
4. **Runner Chain**: `Interaction` → `BaseModelRunner` → Vercel AI SDK
5. **Caching Layer**: `EvaluationCache` persists responses to filesystem

### External Dependencies

| Provider | API Endpoint | Env Variable |
|----------|--------------|--------------|
| Google | `generativelanguage.googleapis.com` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenRouter | `api.openrouter.ai/v1` | `OPENROUTER_API_KEY` |
| GitHub | `models.inference.ai.azure.com` | `GITHUB_TOKEN` |
| Ollama | `localhost:11434` | (local) |
| LM Studio | configurable | (local) |

---

## 4. TESTING ANALYSIS

### Coverage Summary

| Metric | Value |
|--------|-------|
| **Test Files** | 45 |
| **Test Cases** | 556 |
| **Source Files** | 114 |
| **Coverage** | ~34% of files |

### Test Distribution by Module

| Module | Test Files | Status |
|--------|-----------|--------|
| Evaluation | 8 | Well tested |
| Stimulus | 14 | Well tested |
| Cognition | 4 | Partial |
| Providers | 5 | Tested |
| Memory | 2 | Partial |
| Schema | 4 | Tested |
| CLI | 2 | Minimal |
| UI | 3 | Partial |
| MCP | 0 | **Untested** |

### Testing Strengths
- Good unit test coverage for core business logic
- Proper mocking patterns with Vitest
- Edge case testing for cost calculations, schema parsing
- Conditional test execution for external services

### Critical Testing Gaps

1. **MCP Integration** - 0% coverage (8 files completely untested)
2. **CLI Commands** - chat.ts, eval.ts, run.ts, mcp.ts lack tests
3. **Evaluation Engine** - runner.ts, report-generator.ts, scorer.ts untested
4. **Analysis Modules** - comprehensive-analyzer, performance-analyzer untested
5. **Stimulus Tools** - pdf-tools, audio-tools, image-tools lack tests

---

## 5. TOP 5 PRIORITIES TO WORK ON

### Priority 1: MCP Integration Testing & Completion
**Risk: HIGH | Effort: MEDIUM**

The MCP (Model Context Protocol) module has **0% test coverage** and appears incomplete:
- `src/mcp/client/client.ts` - MCPClient untested
- `src/mcp/server/server.ts` - Untested
- `src/mcp/integration/stimulus.ts` - Integration untested
- All transport types untested

**Recommendation**: Add comprehensive tests and verify MCP functionality works end-to-end.

### Priority 2: CLI Command Test Coverage
**Risk: HIGH | Effort: MEDIUM**

Core CLI commands lack tests:
- `chat.ts` / `chat-new.ts` - No tests
- `eval.ts` - No tests
- `run.ts` - No tests
- `mcp.ts` - No tests

**Recommendation**: Add integration tests for CLI commands to prevent regressions.

### Priority 3: Evaluation Reporting & Analysis Pipeline
**Risk: MEDIUM | Effort: MEDIUM**

Analysis modules are complex but untested:
- `report-generator.ts` - Report generation logic
- `comprehensive-analyzer.ts` - Combined analysis
- `performance-analyzer.ts` - Performance metrics
- `quality-analyzer.ts` - Quality scoring

**Recommendation**: Add unit tests and verify report generation works correctly.

### Priority 4: Memory System Completion
**Risk: MEDIUM | Effort: LOW**

Memory system has gaps:
- `memory_store.ts` - Only integration tested
- `memory_runner.ts` - No direct tests
- Hook system could use documentation

**Recommendation**: Add unit tests and document the hook-based fact extraction flow.

### Priority 5: Stimulus Tools Testing
**Risk: LOW | Effort: LOW**

Tool modules lack comprehensive tests:
- `pdf-tools.ts`
- `audio-tools.ts`
- `image-tools.ts`
- Various template modules

**Recommendation**: Add tests, especially for tool calling integration with models.

---

## Architectural Observations

### Strengths
1. **Clean separation of concerns** - Provider, Runner, Evaluation patterns
2. **Extensible strategy pattern** - Easy to add new evaluation types
3. **Type safety** - Zod schemas throughout
4. **Caching system** - Well-structured file-based caching

### Weaknesses
1. **Incomplete MCP integration** - Protocol support exists but may not work
2. **Limited error handling tests** - Happy path tested, error paths less so
3. **Documentation gaps** - Complex flows could use more inline docs
4. **Test coverage concentrated** - Core logic tested, edges less so

---

## File Statistics

- **Total TypeScript Files**: 159
- **Source Files**: 114
- **Test Files**: 45
- **Lines of Code**: ~15,000+ (estimated)
- **External Dependencies**: Vercel AI SDK, Zod, Commander, Ink

---

## Current Package Versions

```json
{
  "dependencies": {
    "@ai-sdk/google": "^2.0.23",
    "@ai-sdk/openai-compatible": "^1.0.22",
    "@google/generative-ai": "^0.24.1",
    "@openrouter/ai-sdk-provider": "^1.2.0",
    "ai": "^5.0.76",
    "chalk": "^5.6.2",
    "commander": "^14.0.1",
    "ink": "^6.3.1",
    "ollama-ai-provider-v2": "^1.5.1",
    "react": "^19.2.0",
    "tiktoken": "^1.0.22",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.0.0",
    "vite": "^7.1.11"
  }
}
```
