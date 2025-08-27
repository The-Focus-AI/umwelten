import { BaseModelRunner } from "../cognition/runner.js";
import { ModelDetails, ModelResponse } from "../cognition/types.js";
import { Interaction } from "../interaction/interaction.js";
import { FunctionEvaluationRunner } from "./evaluate.js";
import { calculateCost, CostBreakdown } from "../costs/costs.js";
import { getAllModels } from "../cognition/models.js";
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
  concurrent?: boolean; // Enable concurrent evaluation (default: false)
  maxConcurrency?: number; // Max concurrent evaluations (default: 3)
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

// Utility function to limit concurrent execution
async function limitConcurrency<T, R>(
  items: T[],
  asyncFunction: (item: T) => Promise<R>,
  maxConcurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = asyncFunction(item).then((result) => {
      results.push(result);
    });
    
    executing.push(promise);
    
    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      // Remove completed promises
      const stillExecuting = executing.filter(p => !isPromiseResolved(p));
      executing.length = 0;
      executing.push(...stillExecuting);
    }
  }
  
  // Wait for remaining promises to complete
  await Promise.all(executing);
  return results;
}

// Helper to check if a promise is resolved (simplified approach)
function isPromiseResolved<T>(promise: Promise<T>): boolean {
  // This is a simplified check - in practice we'd use a more sophisticated approach
  // For now, we'll rely on the race pattern above
  return false;
}

// Better concurrent execution using Promise.all with batching
async function runConcurrentWithBatching<T, R>(
  items: T[],
  asyncFunction: (item: T) => Promise<R>,
  maxConcurrency: number
): Promise<R[]> {
  const results: R[] = [];
  
  // Process items in batches
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(batch.map(asyncFunction));
    results.push(...batchResults);
  }
  
  return results;
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

// Progress callback types
export interface EvaluationProgress {
  modelName: string;
  status: 'starting' | 'streaming' | 'completed' | 'error';
  content?: string;
  error?: string;
  metadata?: any;
}

export type ProgressCallback = (progress: EvaluationProgress) => void;

// Enhanced evaluation config with progress callback
export interface EnhancedEvaluationConfig extends EvaluationConfig {
  onProgress?: ProgressCallback;
  useUI?: boolean;
}

// Individual model evaluation function for concurrent execution
async function evaluateModel(
  modelString: string,
  config: EvaluationConfig,
  evaluationFn: (model: ModelDetails) => Promise<ModelResponse>
): Promise<EvaluationResult["results"][0]> {
  try {
    const model = parseModel(modelString, config.temperature);
    const startTime = Date.now();
    
    const runner = new FunctionEvaluationRunner(
      config.evaluationId,
      "responses", 
      evaluationFn
    );
    
    // Check if already exists and resume flag
    const responseFile = runner.getModelResponseFile(model);
    if (fs.existsSync(responseFile) && !config.resume) {
      if (!config.concurrent) {
        console.log(`Skipping ${model.provider}:${model.name} - response already exists`);
      }
      const existingResponse = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      return {
        model,
        success: true,
        response: existingResponse
      };
    }
    
    if (!config.concurrent) {
      console.log(`\nEvaluating ${model.provider}:${model.name}...`);
    }
    
    const response = await runner.evaluate(model);
    
    const endTime = Date.now();
    if (config.concurrent) {
      console.log(`✅ ${model.provider}:${model.name} completed (${endTime - startTime}ms)`);
    }
    
    return {
      model,
      success: true,
      response: response || undefined
    };
    
  } catch (error) {
    // Handle parseModel errors by creating a dummy model for error reporting
    let model: ModelDetails;
    try {
      model = parseModel(modelString, config.temperature);
    } catch (parseError) {
      // If parseModel fails, create a dummy model for error reporting
      model = { name: modelString, provider: 'unknown' as any };
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (config.concurrent) {
      console.error(`❌ ${model.provider}:${model.name} failed: ${errorMessage}`);
    } else {
      console.error(`Error evaluating ${modelString}:`, error);
    }
    
    return {
      model,
      success: false,
      error: errorMessage
    };
  }
}

// Main evaluation runner function
export async function runEvaluation(config: EvaluationConfig): Promise<EvaluationResult> {
  console.log(`Starting evaluation: ${config.evaluationId}`);
  console.log(`Prompt: ${config.prompt}`);
  console.log(`Models: ${config.models.join(", ")}`);
  
  const evaluationFn = createEvaluationFunction(config);
  const maxConcurrency = config.maxConcurrency || 3;
  
  let results: EvaluationResult["results"];
  
  if (config.concurrent) {
    console.log(`🚀 Running concurrent evaluation (max concurrency: ${maxConcurrency})`);
    
    // Create evaluation function for each model
    const evaluateModelForConfig = (modelString: string) => 
      evaluateModel(modelString, config, evaluationFn);
    
    // Run concurrent evaluations in batches
    results = await runConcurrentWithBatching(
      config.models,
      evaluateModelForConfig,
      maxConcurrency
    );
  } else {
    // Sequential execution (original behavior)
    results = [];
    for (const modelString of config.models) {
      const result = await evaluateModel(modelString, config, evaluationFn);
      results.push(result);
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
  
  // Get all available models for cost calculation
  const allModels = await getAllModels();
  
  // Generate report based on format
  switch (format) {
    case 'markdown':
      return generateMarkdownReport(evaluationId, responses, allModels);
    case 'html':
      return generateHTMLReport(evaluationId, responses, allModels);
    case 'json':
      return JSON.stringify({ evaluationId, responses }, null, 2);
    case 'csv':
      return generateCSVReport(evaluationId, responses, allModels);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// Generate markdown report
function generateMarkdownReport(evaluationId: string, responses: ModelResponse[], allModels: ModelDetails[]): string {
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
  let totalCost = 0;
  
  for (const response of responses) {
    const provider = response.metadata.provider;
    const modelName = response.metadata.model;
    const contentStr = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const length = contentStr.length;
    const tokens = response.metadata.tokenUsage;
    const timeMs = response.metadata.startTime && response.metadata.endTime 
      ? new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime()
      : 'N/A';
    
    totalTime += typeof timeMs === 'number' ? timeMs : 0;
    totalTokens += tokens?.total || 0;
    
    const tokenStr = tokens ? `${tokens.promptTokens}/${tokens.completionTokens}/${tokens.total}` : 'N/A';
    
    // Calculate cost
    let costStr = 'Free';
    if (tokens) {
      const modelDetails = allModels.find(m => m.name === modelName && m.provider === provider);
      if (modelDetails) {
        const costBreakdown = calculateCost(modelDetails, tokens);
        if (costBreakdown) {
          costStr = `$${costBreakdown.totalCost.toFixed(6)}`;
          totalCost += costBreakdown.totalCost;
        }
      }
    }
    
    report += `| ${modelName} | ${provider} | ${length} | ${tokenStr} | ${timeMs} | ${costStr} |\n`;
  }
  
  // Aggregated stats
  report += `\n## Statistics\n\n`;
  report += `- **Total Time:** ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)\n`;
  report += `- **Total Tokens:** ${totalTokens}\n`;
  report += `- **Total Cost:** ${totalCost > 0 ? `$${totalCost.toFixed(6)}` : 'Free'}\n`;
  report += `- **Average Response Length:** ${Math.round(responses.reduce((sum, r) => {
    const contentStr = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
    return sum + contentStr.length;
  }, 0) / responses.length)} characters\n`;
  
  // Individual responses
  report += `\n## Individual Responses\n\n`;
  for (const response of responses) {
    const contentStr = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    report += `### ${response.metadata.model} (${response.metadata.provider})\n\n`;
    report += `**Length:** ${contentStr.length} characters  \n`;
    if (response.metadata.tokenUsage) {
      report += `**Tokens:** ${response.metadata.tokenUsage.total} (${response.metadata.tokenUsage.promptTokens} prompt + ${response.metadata.tokenUsage.completionTokens} completion)  \n`;
    }
    if (response.metadata.startTime && response.metadata.endTime) {
      const time = new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime();
      report += `**Time:** ${time}ms (${(time / 1000).toFixed(1)}s)  \n`;
    }
    report += `\n**Response:**\n\`\`\`\n${contentStr}\n\`\`\`\n\n`;
  }
  
  return report;
}

// Generate HTML report (simplified version)
function generateHTMLReport(evaluationId: string, responses: ModelResponse[], allModels: ModelDetails[]): string {
  const markdown = generateMarkdownReport(evaluationId, responses, allModels);
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
function generateCSVReport(evaluationId: string, responses: ModelResponse[], allModels: ModelDetails[]): string {
  const headers = ['Model', 'Provider', 'Response_Length', 'Prompt_Tokens', 'Completion_Tokens', 'Total_Tokens', 'Time_Ms', 'Cost_USD'];
  let csv = headers.join(',') + '\n';
  
  for (const response of responses) {
    const modelName = response.metadata.model;
    const provider = response.metadata.provider;
    const contentStr = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const length = contentStr.length;
    const tokens = response.metadata.tokenUsage;
    const timeMs = response.metadata.startTime && response.metadata.endTime 
      ? new Date(response.metadata.endTime).getTime() - new Date(response.metadata.startTime).getTime()
      : '';
    
    // Calculate cost
    let cost = 0;
    if (tokens) {
      const modelDetails = allModels.find(m => m.name === modelName && m.provider === provider);
      if (modelDetails) {
        const costBreakdown = calculateCost(modelDetails, tokens);
        if (costBreakdown) {
          cost = costBreakdown.totalCost;
        }
      }
    }
    
    const row = [
      `"${modelName}"`,
      `"${provider}"`,
      length,
      tokens?.promptTokens || '',
      tokens?.completionTokens || '',
      tokens?.total || '',
      timeMs,
      cost.toFixed(6)
    ];
    
    csv += row.join(',') + '\n';
  }
  
  return csv;
}

// List available evaluations
export interface EvaluationSummary {
  id: string;
  path: string;
  responseCount: number;
  lastModified: Date;
  modelNames?: string[];
  hasReports?: boolean;
}

export function listEvaluations(includeDetails: boolean = false): EvaluationSummary[] {
  const evaluationsDir = path.join(process.cwd(), "output", "evaluations");
  
  if (!fs.existsSync(evaluationsDir)) {
    return [];
  }
  
  const evaluations: EvaluationSummary[] = [];
  const entries = fs.readdirSync(evaluationsDir);
  
  for (const entry of entries) {
    const evalPath = path.join(evaluationsDir, entry);
    const stats = fs.statSync(evalPath);
    
    if (!stats.isDirectory()) continue;
    
    const responsesDir = path.join(evalPath, "responses");
    let responseCount = 0;
    let modelNames: string[] = [];
    
    if (fs.existsSync(responsesDir)) {
      const responseFiles = fs.readdirSync(responsesDir).filter(f => f.endsWith('.json'));
      responseCount = responseFiles.length;
      
      if (includeDetails && responseCount > 0) {
        // Extract model names from response files
        modelNames = responseFiles.map(f => {
          try {
            const content = fs.readFileSync(path.join(responsesDir, f), 'utf8');
            const response = JSON.parse(content);
            return `${response.metadata.model} (${response.metadata.provider})`;
          } catch {
            return f.replace('.json', '');
          }
        });
      }
    }
    
    // Check for reports
    const reportsDir = path.join(evalPath, "reports");
    const analysisDir = path.join(evalPath, "analysis");
    const hasReports = fs.existsSync(reportsDir) || fs.existsSync(analysisDir);
    
    evaluations.push({
      id: entry,
      path: evalPath,
      responseCount,
      lastModified: stats.mtime,
      modelNames: includeDetails ? modelNames : undefined,
      hasReports: includeDetails ? hasReports : undefined
    });
  }
  
  // Sort by last modified (newest first)
  return evaluations.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

// Individual model evaluation function with progress callbacks for concurrent execution
async function evaluateModelWithProgress(
  modelString: string,
  config: EnhancedEvaluationConfig,
  evaluationFn: (model: ModelDetails) => Promise<ModelResponse>
): Promise<EvaluationResult["results"][0]> {
  try {
    const model = parseModel(modelString, config.temperature);
    
    // Notify progress: starting
    config.onProgress?.({
      modelName: `${model.provider}:${model.name}`,
      status: 'starting'
    });
    
    const runner = new FunctionEvaluationRunner(
      config.evaluationId,
      "responses", 
      evaluationFn
    );
    
    // Check if already exists and resume flag
    const responseFile = runner.getModelResponseFile(model);
    if (fs.existsSync(responseFile) && !config.resume) {
      const existingResponse = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
      
      // Notify progress: completed (cached)
      config.onProgress?.({
        modelName: `${model.provider}:${model.name}`,
        status: 'completed',
        content: existingResponse.content,
        metadata: existingResponse.metadata
      });
      
      return {
        model,
        success: true,
        response: existingResponse
      };
    }
    
    // For streaming, we'd need to modify the evaluation function
    // For now, simulate streaming with the actual response
    const response = await runner.evaluate(model);
    
    if (response) {
      // Notify progress: streaming (simulate chunks)
      const words = response.content.split(' ');
      let accumulatedContent = '';
      
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(' ') + ' ';
        accumulatedContent += chunk;
        
        config.onProgress?.({
          modelName: `${model.provider}:${model.name}`,
          status: 'streaming',
          content: accumulatedContent.trim()
        });
        
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Notify progress: completed
      config.onProgress?.({
        modelName: `${model.provider}:${model.name}`,
        status: 'completed',
        content: response.content,
        metadata: response.metadata
      });
      
      return {
        model,
        success: true,
        response: response
      };
    }
    
    throw new Error('No response received');
    
  } catch (error) {
    // Handle parseModel errors by creating a dummy model for error reporting
    let model: ModelDetails;
    try {
      model = parseModel(modelString, config.temperature);
    } catch (parseError) {
      model = { name: modelString, provider: 'unknown' as any };
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Notify progress: error
    config.onProgress?.({
      modelName: `${model.provider}:${model.name}`,
      status: 'error',
      error: errorMessage
    });
    
    return {
      model,
      success: false,
      error: errorMessage
    };
  }
}

// Enhanced evaluation runner with streaming and progress callbacks
export async function runEvaluationWithProgress(config: EnhancedEvaluationConfig): Promise<EvaluationResult> {
  const evaluationFn = createEvaluationFunction(config);
  const maxConcurrency = config.maxConcurrency || 3;
  
  let results: EvaluationResult["results"];
  
  if (config.concurrent) {
    // Create evaluation function for each model with progress
    const evaluateModelForConfig = (modelString: string) => 
      evaluateModelWithProgress(modelString, config, evaluationFn);
    
    // Run concurrent evaluations in batches
    results = await runConcurrentWithBatching(
      config.models,
      evaluateModelForConfig,
      maxConcurrency
    );
  } else {
    // Sequential execution (original behavior)
    results = [];
    for (const modelString of config.models) {
      const result = await evaluateModelWithProgress(modelString, config, evaluationFn);
      results.push(result);
    }
  }
  
  // Get output directory
  const outputDir = path.join(process.cwd(), "output", "evaluations", config.evaluationId);
  
  return {
    evaluationId: config.evaluationId,
    outputDir,
    results
  };
}

// Export utility functions that might be useful for other commands
export { parseModel as parseModelString };