import { EvaluationRunner } from './runner.js';
import { ModelDetails, ModelResponse } from '../cognition/types.js';
import { SchemaSource, SchemaValidationResult, schemaManager } from '../schema/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Configuration for schema-based evaluation
 */
export interface SchemaEvaluationConfig {
  schema: SchemaSource;
  validateOutput?: boolean;
  coerceOutput?: boolean;
  failOnValidationError?: boolean;
  strictValidation?: boolean;
}

/**
 * Results of schema validation for an evaluation
 */
export interface SchemaEvaluationResult {
  modelResponse: ModelResponse;
  validation?: SchemaValidationResult;
  schemaUsed: SchemaSource;
  config: SchemaEvaluationConfig;
}

/**
 * Enhanced evaluation runner with schema validation support
 */
export abstract class SchemaEvaluationRunner extends EvaluationRunner {
  protected config: SchemaEvaluationConfig;

  constructor(evaluationId: string, config: SchemaEvaluationConfig) {
    super(evaluationId);
    this.config = config;
  }

  /**
   * Evaluates a model with schema validation
   */
  async evaluate(details: ModelDetails): Promise<SchemaEvaluationResult | undefined> {
    console.log(`Evaluating ${details.name} ${details.provider} with schema validation`);
    
    const resultFile = this.getSchemaResultFile(details);
    if (fs.existsSync(resultFile)) {
      console.log(`Schema evaluation result already exists for ${details.name} ${details.provider}`);
      return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    }

    try {
      const modelResponse = await this.getModelResponse(details);
      
      let validation: SchemaValidationResult | undefined;
      
      if (this.config.validateOutput && modelResponse.content) {
        // Try to parse the response content as JSON
        let parsedContent: any;
        try {
          if (typeof modelResponse.content === 'string') {
            parsedContent = JSON.parse(modelResponse.content);
          } else {
            parsedContent = modelResponse.content;
          }
        } catch (error) {
          // If it's not valid JSON, create a validation error
          validation = {
            success: false,
            errors: [`Response is not valid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`]
          };
        }

        if (!validation && parsedContent) {
          // Validate the parsed content against the schema
          validation = await schemaManager.validateData(parsedContent, this.config.schema, {
            coerce: this.config.coerceOutput || false,
            strict: this.config.strictValidation || false
          });

          // If coercion was applied, update the model response
          if (this.config.coerceOutput && validation.success && validation.data) {
            modelResponse.content = JSON.stringify(validation.data, null, 2);
          }
        }

        // Handle validation failures
        if (!validation?.success && this.config.failOnValidationError) {
          console.error(`Schema validation failed for ${details.name} ${details.provider}:`, validation?.errors);
          
          // Still save the result even if validation failed
          const result: SchemaEvaluationResult = {
            modelResponse,
            validation,
            schemaUsed: this.config.schema,
            config: this.config
          };
          
          fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
          return result;
        }
      }

      const result: SchemaEvaluationResult = {
        modelResponse,
        validation,
        schemaUsed: this.config.schema,
        config: this.config
      };

      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
      
      // Also save the regular model response for compatibility
      const modelResponseFile = this.getModelResponseFile(details);
      fs.writeFileSync(modelResponseFile, JSON.stringify(modelResponse, null, 2));
      
      return result;
    } catch (error) {
      console.error(`Error evaluating ${details.name} ${details.provider}: ${error}`);
      return undefined;
    }
  }

  /**
   * Gets all schema evaluation results
   */
  async getSchemaResults(): Promise<SchemaEvaluationResult[]> {
    const directory = path.resolve(this.getWorkdir(), 'schema-results');
    
    if (!fs.existsSync(directory)) {
      return [];
    }

    const files = fs.readdirSync(directory);
    return files.map(file => {
      return JSON.parse(
        fs.readFileSync(path.resolve(directory, file), 'utf8')
      ) as SchemaEvaluationResult;
    });
  }

  /**
   * Gets schema validation summary across all evaluated models
   */
  async getValidationSummary(): Promise<{
    total: number;
    passed: number;
    failed: number;
    validationRate: number;
    commonErrors: string[];
  }> {
    const results = await this.getSchemaResults();
    
    const total = results.length;
    const validatedResults = results.filter(r => r.validation !== undefined);
    const passed = validatedResults.filter(r => r.validation?.success).length;
    const failed = validatedResults.length - passed;
    
    // Collect all errors to find common ones
    const allErrors: string[] = [];
    validatedResults.forEach(r => {
      if (r.validation?.errors) {
        allErrors.push(...r.validation.errors);
      }
    });
    
    // Count error frequency and get top 5
    const errorCounts = new Map<string, number>();
    allErrors.forEach(error => {
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
    });
    
    const commonErrors = Array.from(errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([error]) => error);

    return {
      total,
      passed,
      failed,
      validationRate: validatedResults.length > 0 ? passed / validatedResults.length : 0,
      commonErrors
    };
  }

  /**
   * Gets the file path for schema evaluation results
   */
  protected getSchemaResultFile(details: ModelDetails): string {
    const filename = `${details.name.replace("/", "-")}-${details.provider}.json`;
    const directory = path.resolve(this.getWorkdir(), 'schema-results');
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return path.resolve(directory, filename);
  }

  /**
   * Creates a JSON schema for LLM instruction from the configured schema
   */
  async getInstructionSchema(): Promise<object> {
    return await schemaManager.getJSONSchema(this.config.schema);
  }
}