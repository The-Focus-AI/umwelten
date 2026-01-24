/**
 * Conversation Runner - executes multi-step tool conversation scenarios
 */

import { Interaction } from '../../interaction/interaction.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { ModelDetails } from '../../cognition/types.js';
import { ToolValidator } from './tool-validator.js';
import { ToolScorer } from './tool-scoring.js';
import {
  ConversationConfig,
  ConversationStep,
  StepValidationResult,
  ToolCall,
  ToolTestResult,
  ToolTestScenario,
} from './types.js';

const DEFAULT_CONFIG: Required<ConversationConfig> = {
  maxConcurrent: 3,
  defaultTimeout: 30000,
  enableCaching: false,
  cacheDir: '.dagger-cache/tool-testing',
  enableAIScoring: false,
  evaluatorModel: { name: 'gpt-oss:latest', provider: 'ollama' },
  verbose: false,
};

export class ConversationRunner {
  private config: Required<ConversationConfig>;
  private validator: ToolValidator;
  private scorer: ToolScorer;
  private runner: BaseModelRunner;

  constructor(config: ConversationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new ToolValidator();
    this.scorer = new ToolScorer(
      this.config.enableAIScoring ? this.config.evaluatorModel : undefined
    );
    this.runner = new BaseModelRunner();
  }

  /**
   * Run all scenarios and return results
   */
  async runScenarios(scenarios: ToolTestScenario[]): Promise<ToolTestResult[]> {
    const results: ToolTestResult[] = [];

    for (const scenario of scenarios) {
      const scenarioResults = await this.runScenario(scenario);
      results.push(...scenarioResults);
    }

    return results;
  }

  /**
   * Run a single scenario against all its models
   */
  async runScenario(scenario: ToolTestScenario): Promise<ToolTestResult[]> {
    const results: ToolTestResult[] = [];

    // Process models in batches
    const batches = this.createBatches(
      scenario.models,
      this.config.maxConcurrent
    );

    for (const batch of batches) {
      const batchPromises = batch.map((model) =>
        this.runScenarioForModel(scenario, model)
      );
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Run a scenario for a specific model
   */
  private async runScenarioForModel(
    scenario: ToolTestScenario,
    model: ModelDetails
  ): Promise<ToolTestResult> {
    const startTime = Date.now();
    const stepResults: StepValidationResult[] = [];
    const errors: string[] = [];
    const perStep: number[] = [];

    if (this.config.verbose) {
      console.log(`\nRunning scenario "${scenario.name}" with ${model.name}`);
    }

    try {
      // Create interaction with stimulus
      const interaction = new Interaction(model, scenario.stimulus);

      // Execute each step
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const stepStartTime = Date.now();

        if (this.config.verbose) {
          console.log(`  Step ${i + 1}: ${step.content.slice(0, 50)}...`);
        }

        try {
          const stepResult = await this.executeStep(
            interaction,
            step,
            scenario.timeout || this.config.defaultTimeout
          );
          stepResults.push(stepResult);
          perStep.push(stepResult.duration);

          if (this.config.verbose) {
            console.log(
              `    ${stepResult.passed ? '✓' : '✗'} ` +
              `(${stepResult.toolCalls.length} tool calls, ${stepResult.duration}ms)`
            );
            if (!stepResult.passed) {
              stepResult.failures.forEach((f) => console.log(`      - ${f}`));
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Step ${i + 1} error: ${errorMsg}`);
          perStep.push(Date.now() - stepStartTime);

          // Create failed step result
          stepResults.push({
            passed: false,
            failures: [errorMsg],
            toolCalls: [],
            response: {
              content: '',
              metadata: {
                startTime: new Date(stepStartTime),
                endTime: new Date(),
                tokenUsage: { promptTokens: 0, completionTokens: 0 },
                provider: model.provider,
                model: model.name,
                cost: {
                  promptCost: 0,
                  completionCost: 0,
                  totalCost: 0,
                  usage: { promptTokens: 0, completionTokens: 0 },
                },
              },
            },
            duration: Date.now() - stepStartTime,
          });

          if (this.config.verbose) {
            console.log(`    ✗ Error: ${errorMsg}`);
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Scenario error: ${errorMsg}`);
    }

    const totalTime = Date.now() - startTime;
    const passed = stepResults.every((r) => r.passed) && errors.length === 0;

    // Calculate score
    let score: number | undefined;
    if (this.config.enableAIScoring && passed) {
      try {
        const scoreResult = await this.scorer.scoreConversation(
          scenario,
          {
            scenario: scenario.name,
            model,
            steps: stepResults,
            passed,
            timing: { total: totalTime, perStep },
            errors,
          }
        );
        score = scoreResult.total;
      } catch (error) {
        if (this.config.verbose) {
          console.log(`    Scoring error: ${error}`);
        }
      }
    } else {
      // Simple heuristic score
      score = this.calculateHeuristicScore(stepResults);
    }

    return {
      scenario: scenario.name,
      model,
      steps: stepResults,
      passed,
      score,
      timing: { total: totalTime, perStep },
      errors,
    };
  }

  /**
   * Execute a single conversation step
   */
  private async executeStep(
    interaction: Interaction,
    step: ConversationStep,
    timeout: number
  ): Promise<StepValidationResult> {
    const startTime = Date.now();

    // Add user message
    interaction.addMessage({
      role: 'user',
      content: step.content,
    });

    // Get response with timeout
    const response = await Promise.race([
      this.runner.streamText(interaction),
      this.createTimeout(timeout),
    ]);

    // Extract tool calls from metadata
    const toolCalls = this.extractToolCalls(response.metadata);

    // Add assistant response to conversation for next turn
    if (response.content) {
      interaction.addMessage({
        role: 'assistant',
        content: response.content,
      });
    }

    const duration = Date.now() - startTime;

    // Validate the step
    return this.validator.validateStep(step, response, toolCalls, duration);
  }

  /**
   * Extract tool calls from response metadata
   * The Vercel AI SDK stores tool calls in various formats depending on the response type
   */
  private extractToolCalls(metadata: any): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Check for toolCalls in metadata (direct format from makeResult)
    if (metadata?.toolCalls && Array.isArray(metadata.toolCalls)) {
      for (const call of metadata.toolCalls) {
        toolCalls.push({
          toolName: call.toolName || call.name || '',
          toolCallId: call.toolCallId || call.id || '',
          args: call.args || call.input || call.arguments || {},
          result: undefined,
        });
      }
    }

    // Check for toolResults which contain both the call and result
    if (metadata?.toolResults && Array.isArray(metadata.toolResults)) {
      for (const result of metadata.toolResults) {
        // See if we already have this tool call
        const existingIdx = toolCalls.findIndex(
          (tc) => tc.toolCallId === result.toolCallId
        );
        if (existingIdx >= 0) {
          toolCalls[existingIdx].result = result.result || result.output;
        } else {
          toolCalls.push({
            toolName: result.toolName || result.name || '',
            toolCallId: result.toolCallId || result.id || '',
            args: result.args || result.input || {},
            result: result.result || result.output,
          });
        }
      }
    }

    return toolCalls;
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms);
    });
  }

  /**
   * Calculate a simple heuristic score
   */
  private calculateHeuristicScore(stepResults: StepValidationResult[]): number {
    if (stepResults.length === 0) return 0;

    let score = 0;
    const stepWeight = 100 / stepResults.length;

    for (const result of stepResults) {
      if (result.passed) {
        score += stepWeight;
      } else {
        // Partial credit based on number of failures
        const failureCount = result.failures.length;
        const partialScore = Math.max(0, stepWeight * (1 - failureCount * 0.25));
        score += partialScore;
      }
    }

    return Math.round(score);
  }

  /**
   * Create batches for concurrent processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}
