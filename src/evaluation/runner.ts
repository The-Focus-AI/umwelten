import path from 'path';
import fs from 'fs';
import { ModelResponse } from '../models/types.js';
import { ModelDetails } from '../models/types.js';
import { Evaluation } from './base.js';

export abstract class EvaluationRunner extends Evaluation {
  constructor(evaluationId: string) {
    super(evaluationId);
  }

  abstract getModelResponse(details: ModelDetails): Promise<ModelResponse>;

  async evaluate(details: ModelDetails): Promise<ModelResponse|undefined> {
    console.log(`Evaluating ${details.name} ${details.provider}`);
    if(fs.existsSync(this.getModelResponseFile(details))) {
      console.log(`Model response file already exists for ${details.name} ${details.provider}`);
      return JSON.parse(fs.readFileSync(this.getModelResponseFile(details), 'utf8'));
    }
    try {
      const modelResponse = await this.getModelResponse(details);
      const modelResponseFile = this.getModelResponseFile(details);
      fs.writeFileSync(modelResponseFile, JSON.stringify(modelResponse, null, 2));
      return modelResponse;
    } catch (error) {
      console.error(`Error evaluating ${details.name} ${details.provider}: ${error}`);
      // throw error;
    }
  }
}