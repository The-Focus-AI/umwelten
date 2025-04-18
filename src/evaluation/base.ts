import path from "path";
import fs from "fs";
import { ModelResponse } from "../models/types.js";
import { ModelDetails } from "../models/types.js";

export abstract class Evaluation {
  private evaluationId: string;
  constructor(evaluationId: string) {
    this.evaluationId = evaluationId;
  }

  getWorkdir() {
    const workdir = path.join(
      process.cwd(),
      "output",
      "evaluations",
      this.evaluationId
    );
    if (!fs.existsSync(workdir)) {
      fs.mkdirSync(workdir, { recursive: true });
    }
    return workdir;
  }

  getTestDataDir() {
    const testDataDir = path.join(process.cwd(), "input", this.evaluationId);
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    return testDataDir;
  }

  async getCachedFile(filename: string, fetch: () => Promise<string>) {
    const file = path.resolve(this.getWorkdir(), filename);
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf8");
    }
    console.log(`Fetching ${filename}`);
    const content = await fetch();
    fs.writeFileSync(file, content);
    return content;
  }

  getModelResponseFile(details: ModelDetails) {
    const filename = `${details.name.replace("/", "-")}-${details.provider}.json`;
    const directory = path.resolve(this.getWorkdir(), "responses");
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return path.resolve(directory, filename);
  }

  getScoreFile(response: ModelResponse) {
    const filename = `${response.metadata.model.replace("/", "-")}-${response.metadata.provider}.json`;
    const directory = path.resolve(this.getWorkdir(), "scores");
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return path.resolve(directory, filename);
  }

  async getModelResponses(): Promise<ModelResponse[]> {
    const directory = path.resolve(this.getWorkdir(), "responses");

    const files = fs.readdirSync(directory);

    const modelResponses = files.map((file) => {
      return JSON.parse(
        fs.readFileSync(path.resolve(directory, file), "utf8")
      ) as ModelResponse;
    });

    return modelResponses;
  }
}
