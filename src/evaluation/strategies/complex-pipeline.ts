import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { Interaction } from '../../interaction/interaction.js';
import { EvaluationCache } from '../caching/cache-service.js';

// Pipeline-specific result type (different from EvaluationResult in types/)
interface PipelineEvaluationResult {
  id: string;
  name: string;
  responses: ModelResponse[];
  metrics: {
    totalTime: number;
    totalTokens: number;
    totalCost: number;
    cacheHits: number;
  };
  scores?: any[];
  metadata: Record<string, any>;
}

export interface EvaluationStep {
  id: string;
  name: string;
  strategy: 'simple' | 'matrix' | 'batch';
  stimulus: Stimulus;
  input: Record<string, any>;
  dependsOn?: string[];
  parallel?: boolean;
  timeout?: number;
  retries?: number;
}

export interface ComplexPipelineOptions {
  id: string;
  name: string;
  description: string;
  cache?: {
    enabled: boolean;
    ttl: number;
    strategy: 'aggressive' | 'conservative' | 'balanced';
  };
  parallel?: {
    enabled: boolean;
    maxConcurrency: number;
  };
  timeout?: number;
  retries?: number;
}

export interface ComplexPipelineResult extends PipelineEvaluationResult {
  steps: {
    [stepId: string]: {
      result: PipelineEvaluationResult;
      dependencies: string[];
      executionTime: number;
      status: 'success' | 'error' | 'skipped';
      error?: Error;
    };
  };
  executionOrder: string[];
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
}

export class ComplexPipeline {
  private options: ComplexPipelineOptions;
  private cache?: EvaluationCache;

  constructor(options: ComplexPipelineOptions) {
    this.options = {
      cache: { enabled: true, ttl: 3600, strategy: 'balanced' },
      parallel: { enabled: true, maxConcurrency: 3 },
      timeout: 300000, // 5 minutes
      retries: 3,
      ...options
    };

    if (this.options.cache?.enabled) {
      this.cache = new EvaluationCache(this.options.id, {
        maxAge: this.options.cache.ttl * 1000, // convert seconds to ms
      });
    }
  }

  async run(params: {
    models: ModelDetails[];
    steps: EvaluationStep[];
  }): Promise<ComplexPipelineResult> {
    const { models, steps } = params;
    const startTime = Date.now();
    
    // Validate steps and dependencies
    this.validateSteps(steps);
    
    // Create execution order based on dependencies
    const executionOrder = this.createExecutionOrder(steps);
    
    // Initialize result structure
    const result: ComplexPipelineResult = {
      id: this.options.id,
      name: this.options.name,
      responses: [],
      metrics: {
        totalTime: 0,
        totalTokens: 0,
        totalCost: 0,
        cacheHits: 0
      },
      scores: [],
      metadata: {
        pipelineId: this.options.id,
        executionOrder,
        totalSteps: steps.length
      },
      steps: {},
      executionOrder,
      totalSteps: steps.length,
      successfulSteps: 0,
      failedSteps: 0
    };

    // Execute steps in order
    for (const stepId of executionOrder) {
      const step = steps.find(s => s.id === stepId);
      if (!step) continue;

      const stepStartTime = Date.now();
      
      try {
        // Check if step should be skipped due to failed dependencies
        if (this.shouldSkipStep(step, result.steps)) {
          result.steps[stepId] = {
            result: this.createEmptyResult(step),
            dependencies: step.dependsOn || [],
            executionTime: 0,
            status: 'skipped'
          };
          continue;
        }

        // Execute step
        const stepResult = await this.executeStep(step, models, result);
        
        result.steps[stepId] = {
          result: stepResult,
          dependencies: step.dependsOn || [],
          executionTime: Date.now() - stepStartTime,
          status: 'success'
        };

        result.successfulSteps++;
        
        // Add step responses to overall result
        result.responses.push(...stepResult.responses);
        result.scores?.push(...(stepResult.scores || []));
        
        // Update metrics
        result.metrics.totalTokens += stepResult.metrics.totalTokens;
        result.metrics.totalCost += stepResult.metrics.totalCost;
        result.metrics.cacheHits += stepResult.metrics.cacheHits;

      } catch (error) {
        result.steps[stepId] = {
          result: this.createEmptyResult(step),
          dependencies: step.dependsOn || [],
          executionTime: Date.now() - stepStartTime,
          status: 'error',
          error: error as Error
        };
        
        result.failedSteps++;
        console.error(`Step ${stepId} failed:`, error);
      }
    }

    result.metrics.totalTime = Date.now() - startTime;
    return result;
  }

  private validateSteps(steps: EvaluationStep[]): void {
    // Check for duplicate step IDs
    const stepIds = steps.map(s => s.id);
    const uniqueIds = new Set(stepIds);
    if (stepIds.length !== uniqueIds.size) {
      throw new Error('Duplicate step IDs found');
    }

    // Check for circular dependencies
    for (const step of steps) {
      if (step.dependsOn) {
        this.checkCircularDependencies(step.id, step.dependsOn, steps);
      }
    }
  }

  private checkCircularDependencies(
    stepId: string, 
    dependencies: string[], 
    steps: EvaluationStep[]
  ): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving step ${id}`);
      }
      if (visited.has(id)) return;

      visiting.add(id);
      const step = steps.find(s => s.id === id);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const dep of dependencies) {
      visit(dep);
    }
  }

  private createExecutionOrder(steps: EvaluationStep[]): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (stepId: string) => {
      if (visiting.has(stepId)) {
        throw new Error(`Circular dependency detected involving step ${stepId}`);
      }
      if (visited.has(stepId)) return;

      visiting.add(stepId);
      const step = steps.find(s => s.id === stepId);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(stepId);
      visited.add(stepId);
      order.push(stepId);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return order;
  }

  private shouldSkipStep(step: EvaluationStep, completedSteps: Record<string, any>): boolean {
    if (!step.dependsOn) return false;
    
    return step.dependsOn.some(depId => {
      const depResult = completedSteps[depId];
      return !depResult || depResult.status !== 'success';
    });
  }

  private async executeStep(
    step: EvaluationStep, 
    models: ModelDetails[], 
    pipelineResult: ComplexPipelineResult
  ): Promise<PipelineEvaluationResult> {
    // Check cache first
    if (this.cache) {
      const cacheKey = this.createCacheKey(step, models);
      try {
        const cached = await this.cache.getCachedFile(cacheKey, async () => {
          // This will only be called if cache miss
          return null;
        });
        if (cached) {
          return cached;
        }
      } catch (error) {
        // Cache miss, continue with execution
      }
    }

    // Prepare input with dependencies
    const input = await this.prepareStepInput(step, pipelineResult);
    
    // Execute based on strategy
    let result: PipelineEvaluationResult;
    
    switch (step.strategy) {
      case 'simple':
        result = await this.executeSimpleStep(step, models[0], input);
        break;
      case 'matrix':
        result = await this.executeMatrixStep(step, models, input);
        break;
      case 'batch':
        result = await this.executeBatchStep(step, models[0], input);
        break;
      default:
        throw new Error(`Unknown strategy: ${step.strategy}`);
    }

    // Cache result using getCachedFile (which will store it)
    if (this.cache) {
      const cacheKey = this.createCacheKey(step, models);
      await this.cache.getCachedFile(cacheKey, async () => result);
    }

    return result;
  }

  private async prepareStepInput(step: EvaluationStep, pipelineResult: ComplexPipelineResult): Promise<Record<string, any>> {
    let input = { ...step.input };

    // Replace dependency placeholders with actual results
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        const depResult = pipelineResult.steps[depId];
        if (depResult && depResult.status === 'success') {
          // Replace placeholders like "step-1-output" with actual results
          const depOutput = depResult.result.responses[0]?.content || '';
          input = this.replacePlaceholders(input, depId, depOutput);
        }
      }
    }

    return input;
  }

  private replacePlaceholders(input: Record<string, any>, depId: string, output: string): Record<string, any> {
    const result = { ...input };
    
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string') {
        result[key] = value.replace(new RegExp(`\\{${depId}-output\\}`, 'g'), output);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.replacePlaceholders(value, depId, output);
      }
    }
    
    return result;
  }

  private async executeSimpleStep(
    step: EvaluationStep, 
    model: ModelDetails, 
    input: Record<string, any>
  ): Promise<PipelineEvaluationResult> {
    const interaction = new Interaction(model, step.stimulus);
    
    // Add input as user message
    interaction.addMessage({
      role: 'user',
      content: JSON.stringify(input)
    });

    const response = await interaction.streamText();
    
    return {
      id: step.id,
      name: step.name,
      responses: [response],
      metrics: {
        totalTime: 0,
        totalTokens: response.metadata.tokenUsage?.total || 0,
        totalCost: response.metadata.cost?.totalCost || 0,
        cacheHits: 0
      },
      scores: [],
      metadata: {
        stepId: step.id,
        strategy: 'simple',
        model: model.name,
        provider: model.provider
      }
    };
  }

  private async executeMatrixStep(
    step: EvaluationStep, 
    models: ModelDetails[], 
    input: Record<string, any>
  ): Promise<PipelineEvaluationResult> {
    const responses: ModelResponse[] = [];
    let totalTokens = 0;
    let totalCost = 0;

    for (const model of models) {
      const interaction = new Interaction(model, step.stimulus);
      interaction.addMessage({
        role: 'user',
        content: JSON.stringify(input)
      });

      const response = await interaction.streamText();
      responses.push(response);
      
      totalTokens += response.metadata.tokenUsage?.total || 0;
      totalCost += response.metadata.cost?.totalCost || 0;
    }

    return {
      id: step.id,
      name: step.name,
      responses,
      metrics: {
        totalTime: 0,
        totalTokens,
        totalCost,
        cacheHits: 0
      },
      scores: [],
      metadata: {
        stepId: step.id,
        strategy: 'matrix',
        models: models.map(m => ({ name: m.name, provider: m.provider }))
      }
    };
  }

  private async executeBatchStep(
    step: EvaluationStep, 
    model: ModelDetails, 
    input: Record<string, any>
  ): Promise<PipelineEvaluationResult> {
    // For batch execution, input should contain an array of items to process
    const items = Array.isArray(input.items) ? input.items : [input];
    const responses: ModelResponse[] = [];
    let totalTokens = 0;
    let totalCost = 0;

    for (const item of items) {
      const interaction = new Interaction(model, step.stimulus);
      interaction.addMessage({
        role: 'user',
        content: JSON.stringify(item)
      });

      const response = await interaction.streamText();
      responses.push(response);
      
      totalTokens += response.metadata.tokenUsage?.total || 0;
      totalCost += response.metadata.cost?.totalCost || 0;
    }

    return {
      id: step.id,
      name: step.name,
      responses,
      metrics: {
        totalTime: 0,
        totalTokens,
        totalCost,
        cacheHits: 0
      },
      scores: [],
      metadata: {
        stepId: step.id,
        strategy: 'batch',
        model: model.name,
        provider: model.provider,
        itemCount: items.length
      }
    };
  }

  private createCacheKey(step: EvaluationStep, models: ModelDetails[]): string {
    const modelInfo = models.map(m => `${m.name}:${m.provider}`).join(',');
    return `complex-pipeline:${this.options.id}:${step.id}:${modelInfo}`;
  }

  private createEmptyResult(step: EvaluationStep): PipelineEvaluationResult {
    return {
      id: step.id,
      name: step.name,
      responses: [],
      metrics: {
        totalTime: 0,
        totalTokens: 0,
        totalCost: 0,
        cacheHits: 0
      },
      scores: [],
      metadata: {
        stepId: step.id,
        status: 'skipped'
      }
    };
  }
}
