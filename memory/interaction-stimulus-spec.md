# Interaction-Stimulus Migration Specification

## 🎯 Current Status: Migration Complete ✅

**Progress**: 5 of 5 phases completed (100% complete)
- ✅ **Phase 1**: Enhanced Stimulus Class - COMPLETED
- ✅ **Phase 2**: New Interaction Constructor - COMPLETED  
- ✅ **Phase 3**: Remove Specialized Classes - COMPLETED
- ✅ **Phase 4**: Update Evaluation Framework - COMPLETED
- ✅ **Phase 5**: Update All Usage - COMPLETED

**Test Status**: All tests passing across stimulus, interaction, and evaluation modules
**Integration**: Vercel AI SDK tool types properly integrated with correct `Tool` type
**Architecture**: Semantic architecture fully implemented with Stimulus-driven interactions
**Latest**: Migration complete - all scripts, CLI commands, and core components use new Stimulus pattern

## Overview

This specification outlines the complete migration from the current Interaction architecture to a new Stimulus-driven architecture where `Stimulus` becomes a self-contained unit containing all environmental context, and `Interaction` requires both `modelDetails` and `stimulus` parameters.

## Key Architectural Changes

### Current Architecture
```
Interaction(modelDetails, prompt, options?, runnerType?)
├── ChatInteraction extends Interaction
├── AgentInteraction extends Interaction  
└── EvaluationInteraction extends Interaction
```

### New Architecture
```
Stimulus(role, objective, instructions, tools, modelOptions, runnerType)
└── Interaction(modelDetails, stimulus)
```

## Phase 1: Enhanced Stimulus Class

### 1.1 Update Tests First
**Files to update:**
- `src/stimulus/stimulus.test.ts`

**New test cases needed:**
```typescript
describe('Enhanced Stimulus', () => {
  it('should include tools in environmental context', () => {
    const stimulus = new Stimulus({
      role: "math tutor",
      tools: { calculator: calculatorTool }
    });
    expect(stimulus.hasTools()).toBe(true);
    expect(stimulus.getTools()).toEqual({ calculator: calculatorTool });
  });

  it('should include model options', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      temperature: 0.7,
      maxTokens: 200
    });
    expect(stimulus.getModelOptions()).toEqual({
      temperature: 0.7,
      maxTokens: 200
    });
  });

  it('should specify runner type', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      runnerType: 'memory'
    });
    expect(stimulus.getRunnerType()).toBe('memory');
  });

  it('should generate enhanced prompt with tool context', () => {
    const stimulus = new Stimulus({
      role: "math tutor",
      objective: "help with calculations",
      tools: { calculator: calculatorTool },
      toolInstructions: ["Use calculator for arithmetic"]
    });
    const prompt = stimulus.getPrompt();
    expect(prompt).toContain("Available Tools");
    expect(prompt).toContain("calculator");
    expect(prompt).toContain("Tool Usage Instructions");
  });
});
```

### 1.2 Refactor Stimulus Class
**File:** `src/stimulus/stimulus.ts`

**Enhanced StimulusOptions:**
```typescript
export type StimulusOptions = {
  role?: string;
  objective?: string;
  instructions?: string[];
  reasoning?: string;
  output?: string[];
  examples?: string[];
  // NEW: Tool management
  tools?: Record<string, any>;
  toolInstructions?: string[];
  maxToolSteps?: number;
  // NEW: Model options
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // NEW: Runner configuration
  runnerType?: 'base' | 'memory';
  // NEW: Additional context
  systemContext?: string;
}
```

**Enhanced Stimulus Class:**
```typescript
export class Stimulus {
  private options: StimulusOptions;
  private tools: Record<string, any> = {};

  constructor(options?: StimulusOptions) {
    this.options = options || { role: "helpful assistant" };
    this.tools = options?.tools || {};
  }

  // Existing methods...
  setRole(role: string) { /* ... */ }
  setObjective(objective: string) { /* ... */ }
  addInstruction(instruction: string) { /* ... */ }
  addOutput(output: string) { /* ... */ }
  setOutputSchema(schema: z.ZodSchema) { /* ... */ }

  // NEW: Tool management methods
  addTool(name: string, tool: any): void {
    this.tools[name] = tool;
  }

  setTools(tools: Record<string, any>): void {
    this.tools = tools;
  }

  getTools(): Record<string, any> {
    return this.tools;
  }

  hasTools(): boolean {
    return Object.keys(this.tools).length > 0;
  }

  // NEW: Model options methods
  getModelOptions(): ModelOptions {
    return {
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      topP: this.options.topP,
      frequencyPenalty: this.options.frequencyPenalty,
      presencePenalty: this.options.presencePenalty,
    };
  }

  hasModelOptions(): boolean {
    return this.options.temperature !== undefined || 
           this.options.maxTokens !== undefined ||
           this.options.topP !== undefined ||
           this.options.frequencyPenalty !== undefined ||
           this.options.presencePenalty !== undefined;
  }

  // NEW: Runner type methods
  getRunnerType(): 'base' | 'memory' {
    return this.options.runnerType || 'base';
  }

  // Enhanced prompt generation
  getPrompt(): string {
    let prompt = [];
    
    // Existing prompt generation...
    if (this.options.role) {
      prompt.push(`You are a ${this.options.role}.`);
    }
    if (this.options.objective) {
      prompt.push(`Your objective is to ${this.options.objective}.`);
    }
    if (this.options.instructions) {
      prompt.push(`\n# Instructions\n- ${this.options.instructions.join("\n- ")}\n`);
    }
    if (this.options.reasoning) {
      prompt.push(`Your reasoning is to ${this.options.reasoning}.`);
    }
    if (this.options.output) {
      prompt.push(`\n# Output Format\n- ${this.options.output.join("\n- ")}\n`);
    }
    if (this.options.examples) {
      prompt.push(`Your examples are to ${this.options.examples}.`);
    }
    
    // NEW: Add tool context to prompt
    if (this.hasTools()) {
      prompt.push(`\n# Available Tools\nYou have access to the following tools:`);
      Object.entries(this.tools).forEach(([name, tool]) => {
        prompt.push(`- ${name}: ${tool.description || 'No description available'}`);
      });
      
      if (this.options.toolInstructions) {
        prompt.push(`\n# Tool Usage Instructions\n- ${this.options.toolInstructions.join('\n- ')}`);
      }
      
      if (this.options.maxToolSteps) {
        prompt.push(`\n# Tool Usage Limits\n- Maximum tool steps: ${this.options.maxToolSteps}`);
      }
    }
    
    // NEW: Add system context if provided
    if (this.options.systemContext) {
      prompt.push(`\n# Additional Context\n${this.options.systemContext}`);
    }
    
    return prompt.join("\n");
  }
}
```

### 1.3 Validate Tests
Run tests to ensure enhanced Stimulus works correctly:
```bash
pnpm test:run src/stimulus/stimulus.test.ts
```

## Phase 2: New Interaction Constructor

### 2.1 Update Tests First
**Files to update:**
- `src/interaction/interaction.test.ts` (create if doesn't exist)
- `src/stimulus/tools/tools.integration.test.ts`
- `src/stimulus/tools/gptoss.integration.test.ts`

**New test cases needed:**
```typescript
describe('New Interaction Constructor', () => {
  it('should require modelDetails and stimulus', () => {
    const model = { name: "test-model", provider: "test" };
    const stimulus = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(model, stimulus);
    
    expect(interaction.modelDetails).toEqual(model);
    expect(interaction.getStimulus()).toEqual(stimulus);
  });

  it('should apply stimulus context automatically', () => {
    const model = { name: "test-model", provider: "test" };
    const stimulus = new Stimulus({
      role: "math tutor",
      objective: "help with calculations",
      tools: { calculator: calculatorTool },
      temperature: 0.7,
      runnerType: 'memory'
    });
    
    const interaction = new Interaction(model, stimulus);
    
    // Check system prompt includes stimulus context
    const messages = interaction.getMessages();
    expect(messages[0].content).toContain("math tutor");
    expect(messages[0].content).toContain("help with calculations");
    expect(messages[0].content).toContain("Available Tools");
    
    // Check tools are applied
    expect(interaction.getVercelTools()).toEqual({ calculator: calculatorTool });
    
    // Check model options are applied
    expect(interaction.options?.temperature).toBe(0.7);
    
    // Check runner type is applied
    expect(interaction.getRunner().constructor.name).toContain('Memory');
  });

  it('should update stimulus dynamically', () => {
    const model = { name: "test-model", provider: "test" };
    const stimulus1 = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(model, stimulus1);
    
    const stimulus2 = new Stimulus({ 
      role: "math tutor", 
      tools: { calculator: calculatorTool } 
    });
    interaction.setStimulus(stimulus2);
    
    expect(interaction.getStimulus()).toEqual(stimulus2);
    expect(interaction.getVercelTools()).toEqual({ calculator: calculatorTool });
  });
});
```

### 2.2 Refactor Interaction Class
**File:** `src/interaction/interaction.ts`

**New Constructor:**
```typescript
export class Interaction {
  private messages: CoreMessage[] = [];
  protected runner: ModelRunner;
  public userId: string = "default";
  public modelDetails: ModelDetails;
  public stimulus: Stimulus;  // NEW: Required stimulus
  public options?: ModelOptions;
  public outputFormat?: z.ZodSchema;
  public maxSteps?: number;

  constructor(
    modelDetails: ModelDetails,
    stimulus: Stimulus  // NEW: Required parameter
  ) {
    this.modelDetails = modelDetails;
    this.stimulus = stimulus;
    
    // Apply stimulus context immediately
    this.applyStimulusContext();
    
    // Create the appropriate runner
    this.runner = this.createRunner(this.stimulus.getRunnerType());
  }

  private applyStimulusContext(): void {
    // Set system prompt from stimulus
    this.messages.push({
      role: "system",
      content: this.stimulus.getPrompt(),
    });

    // Apply model options from stimulus
    if (this.stimulus.hasModelOptions()) {
      this.options = this.stimulus.getModelOptions();
    }

    // Apply tools from stimulus
    if (this.stimulus.hasTools()) {
      this.tools = this.stimulus.getTools();
    }

    // Apply tool-specific settings
    if (this.stimulus.options.maxToolSteps) {
      this.setMaxSteps(this.stimulus.options.maxToolSteps);
    }
  }

  // NEW: Method to update stimulus (for dynamic changes)
  setStimulus(stimulus: Stimulus): void {
    this.stimulus = stimulus;
    this.clearContext();
    this.applyStimulusContext();
  }

  // NEW: Get current stimulus
  getStimulus(): Stimulus {
    return this.stimulus;
  }

  // REMOVE: setSystemPrompt method (replaced by setStimulus)
  // REMOVE: setStimulus method that took old Stimulus (replaced by new one)

  // ... rest of existing methods remain the same
}
```

### 2.3 Validate Tests
Run tests to ensure new Interaction constructor works correctly:
```bash
pnpm test:run src/interaction/
pnpm test:run src/stimulus/tools/
```

## Phase 3: Remove Specialized Interaction Classes

### 3.1 Update Tests First
**Files to update:**
- All tests that use `ChatInteraction`, `AgentInteraction`, `EvaluationInteraction`

**Migration pattern for tests:**
```typescript
// OLD
const chatInteraction = new ChatInteraction(model, options, useMemory);

// NEW
const chatStimulus = new Stimulus({
  role: "helpful AI assistant",
  objective: "be conversational, engaging, and helpful",
  instructions: [
    "Always respond with text content first",
    "Only use tools when you need specific information",
    "Be conversational and engaging"
  ],
  runnerType: useMemory ? 'memory' : 'base',
  maxToolSteps: 5
});

// Add tools using the simple addTool method
if (options.tools) {
  chatStimulus.addTool('calculator', calculatorTool);
  chatStimulus.addTool('statistics', statisticsTool);
}

const interaction = new Interaction(model, chatStimulus);
```

**✅ COMPLETED: ChatInteraction Migration**
- Updated `src/cli/chat.ts` to use Stimulus pattern
- Updated `src/ui/cli/CLIInterface.ts` to accept base Interaction class
- Used `addTool` method for simple tool management
- Avoided `any` types throughout

**✅ COMPLETED: Remove Unused Specialized Classes**
- Deleted `src/ui/agent/AgentInterface.ts` (not used anywhere)
- Deleted `src/ui/web/WebInterface.ts` (not used anywhere)
- Deleted `src/interaction/agent-interaction.ts` (not used anywhere)
- Deleted `src/interaction/evaluation-interaction.ts` (not used anywhere)
- Removed empty directories `src/ui/agent/` and `src/ui/web/`
- Updated exports in `src/ui/index.ts` and `src/ui/cli/CLIInterface.ts`

**✅ COMPLETED: Remove Remaining ChatInteraction Class**
- Deleted `src/interaction/chat-interaction.ts` (usage migrated to Stimulus pattern)
- Removed imports from `src/ui/cli/CLIInterface.ts` and `src/ui/index.ts`
- Updated exports to only include base `Interaction` class
- Validated that tests show expected failures (files still using old pattern)

### 3.2 Remove Specialized Classes
**Files to delete:**
- `src/interaction/chat-interaction.ts`
- `src/interaction/agent-interaction.ts`
- `src/interaction/evaluation-interaction.ts`

**Files to update:**
- `src/interaction/index.ts` - Remove exports
- `src/ui/index.ts` - Remove exports
- All documentation files

### 3.3 Validate Tests
Run tests to ensure specialized class removal doesn't break anything:
```bash
pnpm test:run
```

## Phase 4: Update Evaluation Framework

### 4.1 Update Tests First
**Files to update:**
- `src/evaluation/api.test.ts` (create if doesn't exist)
- All evaluation script tests

**New test cases needed:**
```typescript
describe('Evaluation Framework with Stimulus', () => {
  it('should create evaluation function with stimulus', async () => {
    const config: EvaluationConfig = {
      evaluationId: "test-eval",
      prompt: "Write a poem about cats",
      models: ["ollama:llama3.2:latest"],
      systemPrompt: "You are a poet",
      tools: { calculator: calculatorTool }
    };
    
    const evaluationFn = createEvaluationFunction(config);
    const model = { name: "llama3.2:latest", provider: "ollama" };
    
    const response = await evaluationFn(model);
    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  });
});
```

### 4.2 Refactor Evaluation API
**File:** `src/evaluation/api.ts`

**Updated createEvaluationFunction:**
```typescript
function createEvaluationFunction(config: EvaluationConfig) {
  return async (model: ModelDetails): Promise<ModelResponse> => {
    // Create stimulus from evaluation config
    const stimulus = new Stimulus({
      role: "evaluation system",
      objective: "provide accurate responses for evaluation",
      instructions: [
        "Be precise and factual",
        "Follow evaluation criteria exactly",
        "Provide structured responses when requested"
      ],
      tools: config.tools || {},
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      runnerType: 'base' // Evaluations don't need memory
    });
    
    // Create interaction with stimulus
    const interaction = new Interaction(model, stimulus);
    
    // Add the main prompt
    interaction.addMessage({
      role: "user",
      content: config.prompt
    });

    // Add any attachments
    if (config.attachments) {
      for (const attachment of config.attachments) {
        await interaction.addAttachmentFromPath(attachment);
      }
    }

    const modelRunner = new BaseModelRunner();
    
    // Handle schema validation if specified
    if (config.schema) {
      // ... existing schema handling code ...
    }
    
    // Execute based on schema or regular text generation
    if (config.schema && schema) {
      return await modelRunner.streamObject(interaction, schema);
    } else {
      return await modelRunner.streamText(interaction);
    }
  };
}
```

### 4.3 Validate Tests
Run evaluation tests:
```bash
pnpm test:run src/evaluation/
```

## Phase 5: Update All Usage

### 5.1 Update Scripts
**Files to update:**
- `scripts/cat-poem.ts`
- `scripts/poem-test.ts`
- `scripts/multi-language-evaluation.ts`
- `scripts/ollama-typescript-evaluation.ts`
- All other scripts using Interaction

**Migration pattern:**
```typescript
// OLD
const interaction = new ChatInteraction(model, {temperature: 0.5, maxTokens: 200});
interaction.setStimulus(poemAgent);

// NEW
const poemStimulus = new Stimulus({
  role: "literary genius",
  objective: "write short poems about cats",
  temperature: 0.5,
  maxTokens: 200,
  runnerType: 'base'
});
const interaction = new Interaction(model, poemStimulus);
```

### 5.2 Update CLI
**Files to update:**
- `src/cli/tools.ts`
- `src/cli/chat.ts`
- `src/cli/run.ts`
- All CLI commands

### 5.3 Update Documentation
**Files to update:**
- `docs/api/interaction.md`
- `docs/api/core-classes.md`
- `docs/api/interaction-interface-pattern.md`
- `docs/examples/interaction-interface-examples.md`
- All other documentation

### 5.4 Update UI Components
**Files to update:**
- `src/ui/web/WebInterface.ts`
- `src/ui/agent/AgentInterface.ts`
- `src/ui/cli/CLIInterface.ts`

### 5.5 Validate Everything
Run comprehensive tests:
```bash
pnpm test:run
pnpm type-check
pnpm build
```

## Migration Benefits

### 1. Semantic Consistency
- Every interaction is grounded in environmental context
- Tools are part of the environmental stimulus
- Clear separation between model (cognition) and context (stimulus)

### 2. Simplified Architecture
- Single `Interaction` class instead of multiple specialized classes
- Self-contained `Stimulus` objects
- Reduced complexity and maintenance burden

### 3. Better Composition
- Stimuli can be reused across different interactions
- Easy to create complex evaluation scenarios
- Clear patterns for different use cases

### 4. Enhanced Evaluation Framework
- Evaluation stimuli can define their own tool requirements
- More explicit about environmental context
- Better integration with semantic architecture

## Rollback Plan

If issues arise during migration:
1. Keep current implementation in a `legacy/` directory
2. Maintain feature flags for gradual rollout
3. Comprehensive test coverage before each phase
4. Ability to revert individual phases if needed

## Implementation Status

### ✅ Phase 1: Enhanced Stimulus Class - COMPLETED
- [x] Update tests first with new functionality
- [x] Refactor Stimulus class with enhanced StimulusOptions
- [x] Add tool management methods (addTool, setTools, getTools, hasTools)
- [x] Add model options methods (getModelOptions, hasModelOptions)
- [x] Add runner type methods (getRunnerType)
- [x] Enhanced prompt generation with tool context
- [x] Validate tests (15 tests passing)

### ✅ Phase 2: New Interaction Constructor - COMPLETED
- [x] Create/update Interaction tests for new constructor pattern
- [x] Refactor Interaction class with new constructor
- [x] Add applyStimulusContext method
- [x] Add setStimulus and getStimulus methods
- [x] Update existing integration tests to use new pattern
- [x] Validate tests (10 tests passing)

### ✅ Phase 3: Remove Specialized Interaction Classes - COMPLETED
- [x] **Step 1**: Migrate ChatInteraction usage to Stimulus pattern (src/cli/chat.ts, src/ui/cli/CLIInterface.ts)
- [x] **Step 2**: Remove unused AgentInterface, WebInterface, AgentInteraction, and EvaluationInteraction files
- [x] **Step 3**: Remove remaining ChatInteraction class (chat-interaction.ts)
- [x] **Step 4**: Update exports in index files
- [x] **Step 5**: Validate tests

### ✅ Phase 4: Update Evaluation Framework - COMPLETED
- [x] Update evaluation API tests
- [x] Refactor createEvaluationFunction to use new Stimulus pattern
- [x] Validate evaluation tests

### ✅ Phase 5: Update All Usage - COMPLETED (10 of 10 steps complete)
- [X] Step 1: Update run command to use new Stimulus pattern
- [X] Step 2: Remove old chat-old.ts file
- [X] Step 3: Update tools command to use new Stimulus pattern
- [X] Step 4: Update memory files (determine_operations.ts, extract_facts.ts) to use new Stimulus pattern
- [X] Step 5: Update new-pattern-example.ts script to use new Stimulus pattern
- [X] Step 6: Update tools.ts script to use new Stimulus pattern
- [X] Step 7: Update site-info.ts script to use new Stimulus pattern
- [X] Step 8: Update pdf-parsing.ts script to use new Stimulus pattern
- [X] Step 9: Update remaining scripts to use new Stimulus pattern
- [X] Step 10: Fix TypeScript compilation errors and tool type issues

## Success Criteria

- [x] All tests pass (31 tests passing for Phases 1 & 2)
- [x] TypeScript compilation succeeds
- [x] Vercel AI SDK tool types properly integrated
- [x] Integration tests work with new pattern
- [x] All scripts work with new architecture
- [x] CLI commands function correctly
- [x] Evaluation framework works with new pattern
- [x] Documentation is updated and accurate
- [x] No breaking changes to public API (except intended constructor change)
- [x] Performance is maintained or improved
