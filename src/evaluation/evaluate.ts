import { EvaluationRunner } from "./runner.js";
import { ModelDetails, ModelResponse } from "../models/types.js";
import path from "path";
import fs from "fs";

// FunctionEvaluationRunner that stores results in output/evaluations/<evaluationId>/<key>/<modelname>.json
export class FunctionEvaluationRunner extends EvaluationRunner {
  private fn: (details: ModelDetails) => Promise<ModelResponse>;
  private key: string;
  constructor(evaluationId: string, key: string, fn: (details: ModelDetails) => Promise<ModelResponse>) {
    super(evaluationId);
    this.fn = fn;
    this.key = key;
  }

  getModelResponseFile(details: ModelDetails) {
    // Store in output/evaluations/<evaluationId>/<key>/<modelname>.json
    const filename = `${details.name.replace("/", "-")}.json`;
    const directory = path.resolve(this.getWorkdir(), this.key);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return path.resolve(directory, filename);
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return this.fn(details);
  }
}

// New evaluate function: takes key instead of count
export async function evaluate(
  fn: (details: ModelDetails) => Promise<ModelResponse>,
  evaluationId: string,
  key: string,
  details: ModelDetails
) {
  const runner = new FunctionEvaluationRunner(evaluationId, key, fn);
  await runner.evaluate(details);
}