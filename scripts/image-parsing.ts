import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Stimulus } from "../src/stimulus/stimulus.js";
import { Interaction } from "../src/interaction/interaction.js";
import path from "path";
import { EvaluationRunner } from "../src/evaluation/runner.js";
import { EvaluationScorer } from "../src/evaluation/scorer.js";
import { ScoreResponse, ScoreSchema } from "../src/cognition/types.js";

export async function parseImage(
  imagePath: string,
  model: ModelDetails
): Promise<ModelResponse> {
  const stimulus = new Stimulus({
    role: "image analysis expert",
    objective: "analyze images and provide detailed summaries",
    instructions: [
      "Analyze the image content thoroughly",
      "Provide a comprehensive summary of what you see",
      "Include details about objects, people, settings, and activities"
    ],
    runnerType: 'base'
  });

  const interaction = new Interaction(model, stimulus);

  interaction.addAttachmentFromPath(imagePath);

  const response = await interaction.streamText();

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

    const scoringStimulus = new Stimulus({
      role: "unit testing expert",
      objective: "score the following model response based on the image it is analyzing.",
      instructions: [
        "For each of the following please identify if it's in the content",
        "key: title, value: Archive of ffffound.com",
        "key: pages, value: 3986701",
        "key: views, value: 109886",
        "key: scanned, value: 2017-05-07",
        "key: size, value: 62.2G of data",
        "key: identifier, value: ffffound.com-warc-archive-2017-05-07"
      ],
      output: [
        "You should respond in json format",
        "You should include the key, the found value, and the score in the response",
        "You should score 0 if the found value doesn't exist or doesn't match expected value"
      ],
      runnerType: 'base'
    });

    console.log(scoringStimulus.getPrompt());

    const interaction = new Interaction(
      { provider: "google", name: "gemini-2.5-pro-exp-03-25" },
      scoringStimulus
    );
    interaction.addMessage({ role: "user", content: response.content });

    const newResponse = await interaction.streamObject(ScoreSchema);

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
