/**
 * Tool Scorer - scores tool usage quality using heuristics and AI evaluation
 */

import { Interaction } from '../../interaction/interaction.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { ModelDetails } from '../../cognition/types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import {
  ToolScore,
  ToolTestResult,
  ToolTestScenario,
} from './types.js';

const DEFAULT_WEIGHTS = {
  toolSelection: 0.35,
  parameterAccuracy: 0.25,
  responseQuality: 0.25,
  conversationFlow: 0.15,
};

export class ToolScorer {
  private evaluatorModel?: ModelDetails;
  private runner: BaseModelRunner;

  constructor(evaluatorModel?: ModelDetails) {
    this.evaluatorModel = evaluatorModel;
    this.runner = new BaseModelRunner();
  }

  /**
   * Score a conversation result
   */
  async scoreConversation(
    scenario: ToolTestScenario,
    result: ToolTestResult
  ): Promise<ToolScore> {
    // Calculate heuristic scores
    const breakdown = {
      toolSelection: this.scoreToolSelection(scenario, result),
      parameterAccuracy: this.scoreParameterAccuracy(scenario, result),
      responseQuality: this.scoreResponseQuality(result),
      conversationFlow: this.scoreConversationFlow(result),
    };

    // Get AI evaluation if enabled
    let aiEvaluation: { summary: string; rating: number } | undefined;
    if (this.evaluatorModel) {
      aiEvaluation = await this.getAIEvaluation(scenario, result);

      // Blend AI evaluation with heuristics for response quality
      if (aiEvaluation) {
        const aiScore = (aiEvaluation.rating / 5) * 100;
        breakdown.responseQuality = Math.round(
          breakdown.responseQuality * 0.5 + aiScore * 0.5
        );
      }
    }

    // Calculate weighted total
    const total = Math.round(
      breakdown.toolSelection * DEFAULT_WEIGHTS.toolSelection +
      breakdown.parameterAccuracy * DEFAULT_WEIGHTS.parameterAccuracy +
      breakdown.responseQuality * DEFAULT_WEIGHTS.responseQuality +
      breakdown.conversationFlow * DEFAULT_WEIGHTS.conversationFlow
    );

    return {
      total,
      breakdown,
      weights: DEFAULT_WEIGHTS,
      aiEvaluation,
    };
  }

  /**
   * Score how well the model selected the right tools
   */
  private scoreToolSelection(
    scenario: ToolTestScenario,
    result: ToolTestResult
  ): number {
    let correctCalls = 0;
    let expectedCalls = 0;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepResult = result.steps[i];

      if (!step.expectedToolCalls || !stepResult) continue;

      for (const expected of step.expectedToolCalls) {
        if (expected.required !== false) {
          expectedCalls++;

          const found = stepResult.toolCalls.some(
            (tc) => tc.toolName === expected.toolName
          );
          if (found) {
            correctCalls++;
          }
        }
      }
    }

    if (expectedCalls === 0) return 100;
    return Math.round((correctCalls / expectedCalls) * 100);
  }

  /**
   * Score parameter accuracy for tool calls
   */
  private scoreParameterAccuracy(
    scenario: ToolTestScenario,
    result: ToolTestResult
  ): number {
    let validParams = 0;
    let totalParams = 0;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepResult = result.steps[i];

      if (!step.expectedToolCalls || !stepResult) continue;

      for (const expected of step.expectedToolCalls) {
        if (!expected.parameters) continue;

        const matchingCall = stepResult.toolCalls.find(
          (tc) => tc.toolName === expected.toolName
        );
        if (!matchingCall) continue;

        totalParams++;

        // Check if parameters match
        if (typeof expected.parameters === 'function') {
          if (expected.parameters(matchingCall.args)) {
            validParams++;
          }
        } else {
          // Check each expected parameter
          const paramKeys = Object.keys(expected.parameters);
          let matchCount = 0;
          for (const key of paramKeys) {
            if (matchingCall.args[key] === expected.parameters[key]) {
              matchCount++;
            }
          }
          validParams += matchCount / paramKeys.length;
        }
      }
    }

    if (totalParams === 0) return 100;
    return Math.round((validParams / totalParams) * 100);
  }

  /**
   * Score response quality based on validations passing
   */
  private scoreResponseQuality(result: ToolTestResult): number {
    if (result.steps.length === 0) return 0;

    let totalValidations = 0;
    let passedValidations = 0;

    for (const stepResult of result.steps) {
      // Each step has implied validations
      totalValidations++;
      if (stepResult.failures.length === 0) {
        passedValidations++;
      } else {
        // Partial credit based on failure count
        const failurePenalty = Math.min(stepResult.failures.length * 0.2, 1);
        passedValidations += 1 - failurePenalty;
      }
    }

    return Math.round((passedValidations / totalValidations) * 100);
  }

  /**
   * Score conversation flow handling
   */
  private scoreConversationFlow(result: ToolTestResult): number {
    // Score based on:
    // 1. Steps completing without errors
    // 2. Reasonable timing
    // 3. Tool calls being made when expected

    let score = 100;

    // Penalize errors
    score -= result.errors.length * 20;

    // Penalize very slow steps (> 20 seconds)
    for (const time of result.timing.perStep) {
      if (time > 20000) {
        score -= 10;
      }
    }

    // Penalize steps with no tool calls when expected
    for (let i = 0; i < result.steps.length; i++) {
      const stepResult = result.steps[i];
      if (stepResult.toolCalls.length === 0 && !stepResult.passed) {
        score -= 15;
      }
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get AI evaluation of the conversation
   */
  private async getAIEvaluation(
    scenario: ToolTestScenario,
    result: ToolTestResult
  ): Promise<{ summary: string; rating: number } | undefined> {
    if (!this.evaluatorModel) return undefined;

    try {
      const stimulus = new Stimulus({
        role: 'Tool Usage Evaluator',
        objective: 'Evaluate how well a language model used tools in a conversation',
        instructions: [
          'Analyze the conversation and tool usage',
          'Consider: correct tool selection, parameter accuracy, response coherence',
          'Provide a brief summary and rating from 1-5',
        ],
      });

      const interaction = new Interaction(this.evaluatorModel, stimulus);

      // Build evaluation prompt
      const prompt = this.buildEvaluationPrompt(scenario, result);
      interaction.addMessage({ role: 'user', content: prompt });

      const response = await this.runner.generateText(interaction);

      // Parse rating from response
      const ratingMatch = response.content.match(/rating[:\s]*(\d)/i);
      const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 3;

      return {
        summary: response.content.slice(0, 500),
        rating: Math.min(5, Math.max(1, rating)),
      };
    } catch (error) {
      console.error('AI evaluation error:', error);
      return undefined;
    }
  }

  /**
   * Build the evaluation prompt
   */
  private buildEvaluationPrompt(
    scenario: ToolTestScenario,
    result: ToolTestResult
  ): string {
    let prompt = `# Tool Usage Evaluation

## Scenario: ${scenario.name}
${scenario.description || ''}

## Model: ${result.model.name}

## Conversation Steps:
`;

    for (let i = 0; i < result.steps.length; i++) {
      const step = scenario.steps[i];
      const stepResult = result.steps[i];

      prompt += `\n### Step ${i + 1}
**User:** ${step.content}

**Tool Calls:** ${stepResult.toolCalls.length > 0
        ? stepResult.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(', ')
        : 'None'
      }

**Passed:** ${stepResult.passed}
${stepResult.failures.length > 0 ? `**Failures:** ${stepResult.failures.join('; ')}` : ''}
`;
    }

    prompt += `
## Task
Evaluate the model's tool usage. Consider:
1. Did it select the correct tools?
2. Were the parameters accurate?
3. Did responses make sense given the tool outputs?

Provide a brief summary and end with "Rating: X" where X is 1-5 (5 being excellent).
`;

    return prompt;
  }
}
