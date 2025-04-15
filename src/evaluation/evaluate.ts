import { EvaluationRunner } from "./runner.js";
import { ModelDetails, ModelResponse } from "../models/types.js";

export class FunctionEvaluationRunner extends EvaluationRunner {
  private fn: (details: ModelDetails) => Promise<ModelResponse>;
  constructor(evaluationId: string, fn: (details: ModelDetails) => Promise<ModelResponse>) {
    super(evaluationId);
    this.fn = fn;
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return this.fn(details);
  }
}

export async function evaluate(fn: (details: ModelDetails) => Promise<ModelResponse>, evaluationId: string, details: ModelDetails) {
  const runner = new FunctionEvaluationRunner(evaluationId, fn);
  return await runner.evaluate(details);
}