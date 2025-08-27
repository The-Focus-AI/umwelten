import { BaseModelRunner } from "../cognition/runner.js";
import { ModelDetails, ModelResponse } from "../cognition/types.js";
import { Interaction } from "../interaction/interaction.js";
import { FunctionEvaluationRunner } from "./evaluate.js";
import path from "path";
import fs from "fs";

export interface EvaluationConfig {
  evaluationId: string;
  prompt: string;
  models: string[]; // Format: "provider:model"
  systemPrompt?: string;
  temperature?: number;
  timeout?: number;
  resume?: boolean;
  attachments?: string[]; // File paths to attach
}

export interface EvaluationResult {
  evaluationId: string;
  outputDir: string;
  results: {
    model: ModelDetails;
    success: boolean;
    response?: ModelResponse;
    error?: string;
  }[];
}

// Parse model string from "provider:model" format
export function parseModel(modelString: string, defaultTemp?: number): ModelDetails {
  const [provider, ...modelParts] = modelString.split(":");
  const model = modelParts.join(":");
  
  if (!provider || !model) {
    throw new Error(`Invalid model format: ${modelString}. Expected "provider:model"`);
  }

  return {
    name: model,
    provider: provider as any,
    temperature: defaultTemp
  };
}

// Create an evaluation function from the config
function createEvaluationFunction(config: EvaluationConfig) {
  return async (model: ModelDetails): Promise<ModelResponse> => {
    const conversation = new Interaction(model, config.systemPrompt || "");
    
    // Add the main prompt
    conversation.addMessage({
      role: "user",
      content: config.prompt
    });

    // Add any attachments
    if (config.attachments) {
      for (const attachment of config.attachments) {
        conversation.addAttachmentFromPath(attachment);
      }
    }

    const modelRunner = new BaseModelRunner();
    
    // Use timeout if specified
    if (config.timeout) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), config.timeout);
      });
      
      return Promise.race([
        modelRunner.generateText(conversation),
        timeoutPromise
      ]);
    }
    
    return modelRunner.generateText(conversation);
  };
}

// Main evaluation runner function
export async function runEvaluation(config: EvaluationConfig): Promise<EvaluationResult> {
  console.log(`Starting evaluation: ${config.evaluationId}`);
  console.log(`Prompt: ${config.prompt}`);
  console.log(`Models: ${config.models.join(", ")}`);
  
  const evaluationFn = createEvaluationFunction(config);
  const results: EvaluationResult["results"] = [];
  
  for (const modelString of config.models) {
    try {
      const model = parseModel(modelString, config.temperature);
      console.log(`\nEvaluating ${model.provider}:${model.name}...`);
      
      const runner = new FunctionEvaluationRunner(
        config.evaluationId,
        "responses", 
        evaluationFn
      );
      
      // Check if already exists and resume flag
      const responseFile = runner.getModelResponseFile(model);
      if (fs.existsSync(responseFile) && !config.resume) {
        console.log(`Skipping ${model.provider}:${model.name} - response already exists`);
        const existingResponse = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
        results.push({
          model,
          success: true,
          response: existingResponse
        });
        continue;
      }
      
      const response = await runner.evaluate(model);
      results.push({
        model,
        success: true,
        response: response || undefined
      });
      
    } catch (error) {
      // Handle parseModel errors by creating a dummy model for error reporting
      let model: ModelDetails;
      try {
        model = parseModel(modelString, config.temperature);
      } catch (parseError) {
        // If parseModel fails, create a dummy model for error reporting
        model = { name: modelString, provider: 'unknown' as any };
      }
      
      console.error(`Error evaluating ${modelString}:`, error);
      results.push({
        model,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Get output directory
  const outputDir = path.join(process.cwd(), "output", "evaluations", config.evaluationId);
  
  console.log(`\nEvaluation completed. Results saved to: ${outputDir}`);
  console.log(`Successful: ${results.filter(r => r.success).length}/${results.length}`);
  
  return {
    evaluationId: config.evaluationId,
    outputDir,
    results
  };
}

// Export utility functions that might be useful for other commands
export { parseModel as parseModelString };