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

// Report generation function
export async function generateReport(evaluationId: string, format: 'markdown' | 'html' | 'json' | 'csv' = 'markdown'): Promise<string> {
  const outputDir = path.join(process.cwd(), "output", "evaluations", evaluationId);
  const responsesDir = path.join(outputDir, "responses");
  
  if (!fs.existsSync(responsesDir)) {
    throw new Error(`No evaluation results found for: ${evaluationId}`);
  }
  
  // Load all responses
  const responseFiles = fs.readdirSync(responsesDir).filter(f => f.endsWith('.json'));
  const responses: ModelResponse[] = [];
  
  for (const file of responseFiles) {
    const content = fs.readFileSync(path.join(responsesDir, file), 'utf8');
    responses.push(JSON.parse(content));
  }
  
  if (responses.length === 0) {
    throw new Error(`No valid responses found in: ${responsesDir}`);
  }
  
  // Generate report based on format
  switch (format) {
    case 'markdown':
      return generateMarkdownReport(evaluationId, responses);
    case 'html':
      return generateHTMLReport(evaluationId, responses);
    case 'json':
      return JSON.stringify({ evaluationId, responses }, null, 2);
    case 'csv':
      return generateCSVReport(evaluationId, responses);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// Generate markdown report
function generateMarkdownReport(evaluationId: string, responses: ModelResponse[]): string {
  const timestamp = new Date().toISOString();
  let report = `# Evaluation Report: ${evaluationId}\n\n`;
  report += `**Generated:** ${timestamp}  \n`;
  report += `**Total Models:** ${responses.length}\n\n`;
  
  // Summary table
  report += `## Summary\n\n`;
  report += `| Model | Provider | Response Length | Tokens (P/C/Total) | Time (ms) | Cost Estimate |\n`;
  report += `|-------|----------|----------------|-------------------|-----------|---------------|\n`;
  
  let totalTime = 0;
  let totalTokens = 0;
  
  for (const response of responses) {
    const provider = response.metadata.provider;
    const model = response.metadata.model;
    const length = response.content.length;
    const tokens = response.metadata.tokenUsage;
    const timeMs = response.metadata.startTime && response.metadata.endTime 
      ? new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime()
      : 'N/A';
    
    totalTime += typeof timeMs === 'number' ? timeMs : 0;
    totalTokens += tokens?.total || 0;
    
    const tokenStr = tokens ? `${tokens.promptTokens}/${tokens.completionTokens}/${tokens.total}` : 'N/A';
    const cost = 'N/A'; // TODO: Calculate actual cost
    
    report += `| ${model} | ${provider} | ${length} | ${tokenStr} | ${timeMs} | ${cost} |\n`;
  }
  
  // Aggregated stats
  report += `\n## Statistics\n\n`;
  report += `- **Total Time:** ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)\n`;
  report += `- **Total Tokens:** ${totalTokens}\n`;
  report += `- **Average Response Length:** ${Math.round(responses.reduce((sum, r) => sum + r.content.length, 0) / responses.length)} characters\n`;
  
  // Individual responses
  report += `\n## Individual Responses\n\n`;
  for (const response of responses) {
    report += `### ${response.metadata.model} (${response.metadata.provider})\n\n`;
    report += `**Length:** ${response.content.length} characters  \n`;
    if (response.metadata.tokenUsage) {
      report += `**Tokens:** ${response.metadata.tokenUsage.total} (${response.metadata.tokenUsage.promptTokens} prompt + ${response.metadata.tokenUsage.completionTokens} completion)  \n`;
    }
    if (response.metadata.startTime && response.metadata.endTime) {
      const time = new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime();
      report += `**Time:** ${time}ms (${(time / 1000).toFixed(1)}s)  \n`;
    }
    report += `\n**Response:**\n\`\`\`\n${response.content}\n\`\`\`\n\n`;
  }
  
  return report;
}

// Generate HTML report (simplified version)
function generateHTMLReport(evaluationId: string, responses: ModelResponse[]): string {
  const markdown = generateMarkdownReport(evaluationId, responses);
  // For now, return markdown wrapped in basic HTML
  // In a full implementation, you'd use a proper markdown-to-HTML converter
  return `<!DOCTYPE html>
<html>
<head>
    <title>Evaluation Report: ${evaluationId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f5f5f5; }
        pre { background: #f8f8f8; padding: 15px; border-radius: 5px; overflow-x: auto; }
        code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
    </style>
</head>
<body>
    <pre>${markdown}</pre>
</body>
</html>`;
}

// Generate CSV report
function generateCSVReport(evaluationId: string, responses: ModelResponse[]): string {
  const headers = ['Model', 'Provider', 'Response_Length', 'Prompt_Tokens', 'Completion_Tokens', 'Total_Tokens', 'Time_Ms'];
  let csv = headers.join(',') + '\n';
  
  for (const response of responses) {
    const model = response.metadata.model;
    const provider = response.metadata.provider;
    const length = response.content.length;
    const tokens = response.metadata.tokenUsage;
    const timeMs = response.metadata.startTime && response.metadata.endTime 
      ? new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime()
      : '';
    
    const row = [
      `"${model}"`,
      `"${provider}"`,
      length,
      tokens?.promptTokens || '',
      tokens?.completionTokens || '',
      tokens?.total || '',
      timeMs
    ];
    
    csv += row.join(',') + '\n';
  }
  
  return csv;
}

// Export utility functions that might be useful for other commands
export { parseModel as parseModelString };