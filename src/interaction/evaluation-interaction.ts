import { Interaction } from "./interaction.js";
import { ModelDetails, ModelOptions } from "../cognition/types.js";
import { getAllTools } from "../stimulus/tools/index.js";

/**
 * EvaluationInteraction - Specialized interaction for model evaluation
 * 
 * Pre-configured with:
 * - Evaluation-focused system prompt
 * - Base runner (no memory needed for evaluation)
 * - Evaluation-specific tools
 * - Structured output support
 */
export class EvaluationInteraction extends Interaction {
  constructor(
    modelDetails: ModelDetails, 
    evaluationPrompt: string, 
    options?: ModelOptions
  ) {
    const systemPrompt = `You are an AI evaluation system. Your role is to provide accurate, structured, and objective responses for evaluation purposes. 

Instructions:
- Be precise and factual
- Follow the evaluation criteria exactly
- Provide structured responses when requested
- Use tools when needed for analysis
- Focus on accuracy over creativity

Evaluation prompt: ${evaluationPrompt}`;
    
    super(modelDetails, systemPrompt, options, 'base'); // Use base runner
    
    // Set up evaluation-specific tools
    this.setupEvaluationTools();
    
    // Enable multi-step tool calling for complex evaluations
    this.setMaxSteps(3);
  }

  private setupEvaluationTools(): void {
    const availableTools = getAllTools();
    
    // Select evaluation-relevant tools
    const evaluationTools: Record<string, any> = {};
    
    if (availableTools.calculator) {
      evaluationTools.calculator = availableTools.calculator;
    }
    
    if (availableTools.statistics) {
      evaluationTools.statistics = availableTools.statistics;
    }
    
    // Add more evaluation-specific tools as they become available
    // e.g., codeAnalyzer, factChecker, etc.
    
    this.setTools(evaluationTools);
  }

  /**
   * Run an evaluation with structured output
   */
  async evaluateWithSchema(schema: any): Promise<any> {
    const response = await this.generateObject(schema);
    return response.content;
  }

  /**
   * Run an evaluation and return the raw response
   */
  async evaluate(): Promise<string> {
    const response = await this.generateText();
    return response.content;
  }

  /**
   * Get evaluation metrics from the response
   */
  getEvaluationMetrics(): {
    tokenUsage: any;
    cost?: any;
    responseTime: number;
  } {
    const lastMessage = this.getMessages().slice(-1)[0];
    // This would need to be enhanced to track actual metrics
    return {
      tokenUsage: { promptTokens: 0, completionTokens: 0, total: 0 },
      responseTime: 0
    };
  }
}
