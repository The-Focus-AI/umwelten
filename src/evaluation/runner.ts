import path from 'path';
import fs from 'fs';
import { ModelResponse } from '../models/types.js';
import { ModelDetails } from '../models/types.js';

export abstract class EvaluationRunner {
  private evaluationId: string;
  constructor(evaluationId: string) {
    this.evaluationId = evaluationId;
  }

  abstract getModelResponse(details: ModelDetails): Promise<ModelResponse>;

  getWorkdir() {
    const workdir = path.join(process.cwd(), 'output', 'evaluations', this.evaluationId);
    if (!fs.existsSync(workdir)) {
      fs.mkdirSync(workdir, { recursive: true });
    }
    return workdir;
  }

  getTestDataDir() {
    const testDataDir = path.join(process.cwd(), 'input', this.evaluationId);
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    return testDataDir;
  }

  async getCachedFile(filename: string, fetch: () => Promise<string>) {
    const file = path.resolve(this.getWorkdir(), filename);
    if(fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf8');
    }
    console.log(`Fetching ${filename}`);
    const content = await fetch();
    fs.writeFileSync(file, content);
    return content;
  }

  getModelResponseFile(details: ModelDetails) {
    const filename = `${details.name.replace('/', '-')}-${details.provider}.json`;
    const directory = path.resolve(this.getWorkdir(), "responses");
    if(!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return path.resolve(directory, filename);
  }

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