import { BaseModelRunner } from '../model-runner.js';
import { v4 as uuidv4 } from 'uuid';
import { getModelProvider } from '../providers/index.js';
import chalk from 'chalk';
import type { LanguageModelV1 } from 'ai';
import { ModelDetails } from '../models/types.js';
import type { ModelParameters } from './types.js';
import { EvaluationConfig, EvaluationResults, ModelEvaluationResult, EvaluationScore, ScoringCriterion } from './types.js';

export class EvaluationRunnerError extends Error {
  constructor(message: string, public readonly modelDetails?: ModelDetails) {
    super(message);
    this.name = 'EvaluationRunnerError';
  }
}

export class EvaluationRunner {
  private modelRunner: BaseModelRunner;

  constructor() {
    this.modelRunner = new BaseModelRunner();
  }

  private convertModelParameters(params?: ModelParameters): { temperature?: number; maxTokens?: number; stop?: string[] } {
    if (!params) return {};
    return {
      temperature: params.temperature,
      maxTokens: params.max_tokens
    };
  }

  private async validateModelAccess(config: EvaluationConfig): Promise<void> {
    const modelErrors: string[] = [];
    const requiredModels = [
      { ...config.models.evaluator, purpose: 'Evaluator model (required for scoring)' },
      ...config.models.models.map(m => ({ ...m, purpose: 'Evaluation model' }))
    ];
    
    console.log('\nChecking model availability:');

    for (const model of requiredModels) {
      try {
        console.log(`Checking availability for model ID: ${model.modelDetails.name}`);
        const modelProvider = await getModelProvider(model.modelDetails.name);
        if (!modelProvider) {
          modelErrors.push(chalk.red(`❌ ${model.purpose} ${model.modelDetails.provider}/${model.modelDetails.name} not available`));
        } else {
          // Check if the model is valid
          const isValid = await (modelProvider as any).validModel?.(model.modelDetails.name);
          if (!isValid) {
            modelErrors.push(chalk.red(`❌ ${model.purpose} ${model.modelDetails.provider}/${model.modelDetails.name} is not a valid model`));
          } else {
            console.log(chalk.green(`✓ ${model.purpose} ${model.modelDetails.provider}/${model.modelDetails.name} available and valid`));
          }
        }
      } catch (error) {
        console.error('Error creating model:', error);
        modelErrors.push(chalk.red(`❌ Failed to access ${model.purpose} ${model.modelDetails.provider}/${model.modelDetails.name}: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    }

    if (modelErrors.length > 0) {
      console.error('\nModel Access Validation Failed:');
      modelErrors.forEach(error => console.error(error));
      throw new EvaluationRunnerError('One or more required models are not accessible');
    }
  }

  async runEvaluation(config: EvaluationConfig): Promise<EvaluationResults> {
    // Validate model access before proceeding
    await this.validateModelAccess(config);

    const startTime = new Date();
    const results: ModelEvaluationResult[] = [];
    let totalCost = 0;

    if (config.verbose) {
      console.log(chalk.dim('Starting evaluation at:', startTime.toISOString()));
    }

    // Run evaluation for each model
    for (const modelConfig of config.models.models) {
      try {
        const modelProvider = await getModelProvider(modelConfig.modelDetails.name);
        if (!modelProvider) {
          throw new EvaluationRunnerError(`Model provider not found for ${modelConfig.modelDetails.name}`, modelConfig.modelDetails);
        }

        if (config.verbose) {
          console.log(chalk.dim(`Evaluating model: ${modelConfig.modelDetails.name}`));
          console.log(chalk.dim(`Provider: ${modelConfig.modelDetails.provider}`));
          console.log(chalk.dim(`Prompt: ${config.prompt.question}`));
        }

        // Generate response
        const modelStartTime = new Date();
        const response = await this.modelRunner.execute({
          prompt: this.buildPrompt(config),
          model: modelProvider as LanguageModelV1, // Removed incorrect cast
          options: this.convertModelParameters(modelConfig.parameters)
        });

        if (config.verbose) {
          console.log(chalk.dim(`Response received for model: ${modelConfig.modelDetails.name}`));
          console.log(chalk.dim(`Response content: ${response.content}`));
          console.log(chalk.dim(`Tokens used: ${response.metadata.tokenUsage.total}`));
          console.log(chalk.dim(`Cost: $${response.metadata.cost.toFixed(4)}`));
        }

        // Evaluate response
        const { scores, cost: evaluationCost } = await this.evaluateResponse(response.content, config);
        const totalScore = scores.reduce((sum, score) => sum + score.score, 0);

        // Calculate metadata
        const modelEndTime = new Date();
        const result: ModelEvaluationResult = {
          modelId: modelConfig.modelDetails.name,
          provider: response.metadata.provider, // Get provider from response metadata
          response: response.content,
          scores,
          totalScore,
          metadata: {
            startTime: modelStartTime,
            endTime: modelEndTime,
            tokensUsed: response.metadata.tokenUsage.total,
            cost: response.metadata.cost
          }
        };

        results.push(result);
        totalCost += response.metadata.cost + evaluationCost;
      } catch (error) {
        if (error instanceof Error) {
          console.error(chalk.red(`Error during evaluation of model ${modelConfig.modelDetails.name}: ${error.message}`));
          if (config.verbose) {
            console.error(chalk.dim('Stack trace:', error.stack));
          }
        }
        throw error;
      }
    }

    if (config.verbose) {
      console.log(chalk.dim('Evaluation completed at:', new Date().toISOString()));
      console.log(chalk.dim(`Total cost: $${totalCost.toFixed(4)}`));
    }

    return {
      promptConfig: config.prompt,
      rubricConfig: config.rubric,
      results,
      metadata: {
        evaluationId: uuidv4(),
        startTime,
        endTime: new Date(),
        totalCost
      }
    };
  }

  private buildPrompt(config: EvaluationConfig): string {
    return `${config.prompt.question}

${config.prompt.context}`;
  }

  private async evaluateResponse(
    response: string,
    config: EvaluationConfig
  ): Promise<{ scores: EvaluationScore[]; cost: number }> {
    // Get the evaluator model
    console.log('Evaluating response with evaluator model:', config.models.evaluator.modelDetails.name);
    const evaluator = await getModelProvider(config.models.evaluator.modelDetails.name);
    if (!evaluator) {
      throw new EvaluationRunnerError(`Evaluator model (${config.models.evaluator.modelDetails.name}) not found`);
    }

    const scores: EvaluationScore[] = [];
    let totalEvaluationCost = 0;

    // Evaluate each criterion
    for (const [criterion, details] of Object.entries(config.rubric.scoring_criteria)) {
      const criterionDetails = details as ScoringCriterion;
      const evaluationPrompt = `
${config.rubric.evaluation_prompt}

Response to evaluate:
"""
${response}
"""

You are evaluating the criterion: ${criterion}
Description: ${criterionDetails.description}
Key aspects to consider:
${criterionDetails.key_aspects.map(aspect => `- ${aspect}`).join('\n')}

Maximum points for this criterion: ${criterionDetails.points}

Please provide:
1. A score from 0 to ${criterionDetails.points}
2. Brief reasoning for the score

Format your response exactly like this:
SCORE: [number]
REASONING: [your explanation]`;

      const evaluation = await this.modelRunner.execute({
        prompt: evaluationPrompt,
        model: evaluator,
        options: this.convertModelParameters(config.models.evaluator.parameters)
      });

      totalEvaluationCost += evaluation.metadata.cost;

      // Parse evaluation response
      const [scoreLine, reasoningLine] = evaluation.content.split('\n');
      const score = parseFloat(scoreLine.replace('SCORE:', '').trim());
      const reasoning = reasoningLine.replace('REASONING:', '').trim();

      scores.push({
        criterion,
        score,
        maxPoints: criterionDetails.points,
        reasoning
      });
    }

    return { scores, cost: totalEvaluationCost };
  }
} 