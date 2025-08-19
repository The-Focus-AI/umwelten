import { z } from "zod";
import { BaseModelRunner } from "../src/cognition/runner.js";
import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Stimulus } from "../src/interaction/stimulus.js";
import { Interaction } from "../src/interaction/interaction.js";
import { EvaluationRunner } from "../src/evaluation/runner.js";

const roadtripPromptSchema = z.object({
  startLocation: z.string().describe("The start location of the roadtrip"),
  endLocation: z.string().describe("The end location of the roadtrip"),
  startDate: z
    .string()
    .describe("The start date of the roadtrip in YYYY-MM-DD format"),
  endDate: z
    .string()
    .describe("The end date of the roadtrip in YYYY-MM-DD format"),
  withKids: z
    .boolean()
    .describe("Whether the roadtrip is with kids")
    .optional(),
  scenicStops: z
    .boolean()
    .describe("Whether the roadtrip should include scenic stops")
    .optional(),
  nationalParks: z
    .boolean()
    .describe("Whether the roadtrip should include national parks")
    .optional(),
  restaurants: z
    .boolean()
    .describe("Whether the roadtrip should include restaurants")
    .optional(),
  attractions: z
    .boolean()
    .describe("Whether the roadtrip should include attractions")
    .optional(),
  petFriendly: z
    .boolean()
    .describe("Whether the roadtrip should be pet friendly")
    .optional(),
  camping: z
    .boolean()
    .describe("Whether the roadtrip should include camping")
    .optional(),
});

type RoadTripPrompt = z.infer<typeof roadtripPromptSchema>;

const roadtripSchema = z.object({
  startDate: z
    .string()
    .describe("The start date of the roadtrip in YYYY-MM-DD format"),
  endDate: z
    .string()
    .describe("The end date of the roadtrip in YYYY-MM-DD format"),
  locations: z.array(z.string()).describe("The locations of the roadtrip"),
  legs: z.array(
    z.object({
      startLocation: z.string().describe("The start location of the leg"),
      endLocation: z.string().describe("The end location of the leg"),
      mode: z
        .enum(["charging", "driving", "activity"])
        .describe(
          "If this describes a charging leg, driving leg, or activity leg"
        ),
      type: z
        .enum([
          "restaurants",
          "attractions",
          "nationalParks",
          "scenicStops",
          "charger",
          "hotel",
          "other",
        ])
        .describe(
          "If this describes a restuarant, attraction, national park, or scenic stop"
        ),
      arrivalTime: z
        .string()
        .describe("The arrival time of the leg in HH:MM format"),
      distance: z.number().describe("The distance of the leg in miles"),
      duration: z.number().describe("The duration of the leg in HH:MM format"),
      description: z.string().describe("A description of the leg"),
      startCharge: z
        .number()
        .describe("The start charge of the leg in percent"),
      endCharge: z.number().describe("The end charge of the leg in percent"),
    })
  ),
});

export async function fleshoutPlan(model: ModelDetails) {
  const prompt = new Stimulus();
  prompt.setRole("expert roadtrip planner");
  prompt.addInstruction(
    "You will be given a roadtrip prompt and you will need to plan a roadtrip based on the prompt."
  );
  prompt.addInstruction(`The currrent date is ${new Date().toISOString()}`);
  prompt.addInstruction(
    `Dont make up any information, only use the information provided in the prompt.`
  );

  prompt.setObjective(`Please plan a roadtrip based on the prompt`);
}

export async function planRoadtrip(
  roadTripPrompt: RoadTripPrompt,
  model: ModelDetails
): Promise<ModelResponse> {
  const prompt = new Stimulus();
  prompt.setRole("expert electric vehicle roadtrip planner");
  prompt.addInstruction(
    "You will be given a roadtrip prompt and you will need to plan a roadtrip based on the prompt."
  );
  prompt.addInstruction(
    `You will be given a list of locations and you will need to plan a roadtrip that visits all of the locations.`
  );
  prompt.addInstruction(
    `You will need to plan the roadtrip in a way that is efficient for an electric vehicle.`
  );
  prompt.addInstruction(
    `You will need to plan the roadtrip in a way that is safe for an electric vehicle.`
  );
  prompt.addInstruction(
    `You will need to take in account the users preferences`
  );
  prompt.addInstruction(`The currrent date is ${new Date().toISOString()}`);
  prompt.addInstruction(
    `Dont make up any information, only use the information provided in the prompt.`
  );

  prompt.setObjective(`Please plan a roadtrip based on the prompt`);

  prompt.setOutputSchema(roadtripSchema);

  console.log(prompt.getPrompt());
  const conversation = new Interaction(model, prompt.getPrompt());
  conversation.addMessage({
    role: "user",
    content: JSON.stringify(roadTripPrompt),
  });

  const modelRunner = new BaseModelRunner();
  const response = await modelRunner.streamText(conversation);
  return response;
}

const roadTripPrompt: RoadTripPrompt = {
  startLocation: "Cornwall CT",
  endLocation: "Jay Peak VT",
  startDate: "2024-05-01",
  endDate: "2024-05-05",
  withKids: true,
  scenicStops: true,
  nationalParks: true,
};

class RoadTripEvaluator extends EvaluationRunner {
  private readonly roadTripPrompt: RoadTripPrompt;

  constructor(evaluationId: string, roadTripPrompt: RoadTripPrompt) {
    super(evaluationId);
    this.roadTripPrompt = roadTripPrompt;
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return planRoadtrip(this.roadTripPrompt, details);
  }
}

const runner = new RoadTripEvaluator(
  "roadtrip/cornwall-jay-peak",
  roadTripPrompt
);

await runner.evaluate({
  name: "gemini-2.0-flash",
  provider: "google",
});

await runner.evaluate({
  name: "gemini-2.5-pro-exp-03-25",
  provider: "google",
});

await runner.evaluate({
  name: "gemini-1.5-flash-8b",
  provider: "google",
});


await runner.evaluate({
  name: "anthropic/claude-3.7-sonnet:thinking",
  provider: "openrouter",
});


await runner.evaluate({
  name: "openai/o3",
  provider: "openrouter",
});


await runner.evaluate({
  name: "gemma3:12b",
  provider: "ollama",
});
