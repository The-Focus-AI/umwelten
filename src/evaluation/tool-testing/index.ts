/**
 * Tool Testing Module
 *
 * Framework for evaluating multi-step tool conversations across models.
 *
 * @example
 * ```typescript
 * import { ConversationRunner, ToolTestScenario } from './evaluation/tool-testing';
 * import { calculatorTool } from './stimulus/tools';
 * import { Stimulus } from './stimulus/stimulus';
 *
 * const scenario: ToolTestScenario = {
 *   name: 'Calculator Test',
 *   stimulus: new Stimulus({
 *     role: 'math assistant',
 *     tools: { calculator: calculatorTool },
 *     maxToolSteps: 3
 *   }),
 *   steps: [
 *     {
 *       role: 'user',
 *       content: 'What is 5 + 3?',
 *       expectedToolCalls: [{ toolName: 'calculator' }],
 *       validation: { contentContains: ['8'] }
 *     }
 *   ],
 *   models: [{ name: 'qwen3:latest', provider: 'ollama' }]
 * };
 *
 * const runner = new ConversationRunner({ verbose: true });
 * const results = await runner.runScenarios([scenario]);
 * ```
 */

export { ConversationRunner } from './conversation-runner.js';
export { ToolValidator } from './tool-validator.js';
export { ToolScorer } from './tool-scoring.js';

export type {
  ConversationConfig,
  ConversationStep,
  ExpectedToolCall,
  StepValidation,
  StepValidationResult,
  ToolCall,
  ToolScore,
  ToolTestResult,
  ToolTestScenario,
} from './types.js';
