import { BaseModelRunner } from "../src/cognition/runner.js";
import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Stimulus } from "../src/interaction/stimulus.js";
import { Interaction } from "../src/interaction/interaction.js";
import path from "path";
import { EvaluationRunner } from "../src/evaluation/runner.js";
import { EvaluationScorer } from "../src/evaluation/scorer.js";
import { z } from "zod";

export async function parseImage(
  imagePath: string,
  model: ModelDetails
): Promise<ModelResponse> {
  const prompt = "Analyze this image and provide a summary of the content.";

  const conversation = new Interaction(model, prompt);

  // conversation.addAttachmentFromPath(pdfFile);
  conversation.addAttachmentFromPath(imagePath);

  const modelRunner = new BaseModelRunner();

  const response = await modelRunner.streamText(conversation);

  return response;
}

class ImageParser extends EvaluationRunner {
  private imagePath: string;

  constructor(evaluationId: string, imagePath: string) {
    super(evaluationId);
    this.imagePath = path.resolve(this.getTestDataDir(), imagePath);
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return parseImage(this.imagePath, details);
  }
}

const runner = new ImageParser("image-parsing", "internet_archive_fffound.png");

await runner.evaluate({
  name: "gemma3:12b",
  provider: "ollama",
});

await runner.evaluate({
  name: "qwen2.5:14b",
  provider: "ollama",
});

await runner.evaluate({
  name: "phi4:latest",
  provider: "ollama",
});

await runner.evaluate({
  name: "phi4-mini:latest",
  provider: "ollama",
});

await runner.evaluate({
  name: "gemini-2.0-flash",
  provider: "google",
});

await runner.evaluate({
  name: "gemini-2.5-pro-exp-03-25",
  provider: "google",
});

await runner.evaluate({
  name: "gemini-2.5-flash-preview-04-17",
  provider: "google",
});


class ImageScorer extends EvaluationScorer {
  constructor(evaluationId: string) {
    super(evaluationId);
  }

  async test() {
    const responses = await this.getModelResponses();

    const table = responses.map((response) => {
      return {
        name: response.metadata.model,
        provider: response.metadata.provider,
        time:
          (new Date(response.metadata.endTime).getTime() -
            new Date(response.metadata.startTime).getTime()) /
          1000,
        tokens: response.metadata.tokenUsage.total,
        cost: response.metadata.cost?.totalCost?.toFixed(10),
      };
    });
    console.table(table);
    return 0;
  }

  async scoreResponse(response: ModelResponse): Promise<ScoreResponse> {
    console.log(JSON.stringify(response, null, 2));
    console.log(
      "Evaluating",
      response.metadata.model,
      response.metadata.provider
    );

    const prompt = new Stimulus({
      role: "unit testing expert",
      objective:
        "score the following model response based on the image it is analyzing.",
    });
    prompt.addInstruction( "For each of the following please identify if it's in the content" );
    prompt.addInstruction( "key: title, value: Archve of ffffound.com" );
    prompt.addInstruction( "key: pages, value: 3986701")
    prompt.addInstruction( "key: views, value: 109886")
    prompt.addInstruction( "key: scanned, value: 2017-05-07")
    prompt.addInstruction( "key: size, value: 62.2G of data")
    prompt.addInstruction( "key: identifier, value: ffffound.com-warc-archive-2017-05-07")

    prompt.addOutput("You should respond in json format");
    prompt.addOutput("You should include the key, the found value, and the score in the response");
    prompt.addOutput("You should score 0 if the found value doesn't exist or doesn't match expected value")    

    console.log(prompt.getPrompt());

    const conversation = new Interaction(
      { provider: "google", name: "gemini-2.5-pro-exp-03-25" },
      prompt.getPrompt()
    );
    conversation.addMessage({ role: "user", content: response.content });

    const modelRunner = new BaseModelRunner();

    const newResponse = await modelRunner.streamObject(conversation, ScoreSchema);

    console.log(JSON.stringify(newResponse, null, 2));
    return newResponse as unknown as ScoreResponse;
  }
}

const scorer = new ImageScorer("image-parsing");

await scorer.score();

const responses = await scorer.getModelResponses();
console.log(JSON.stringify(responses[0], null, 2));

await scorer.scoreResponse(responses[0]);

// await scorer.doScore(await scorer.getModelResponses()[0]);
