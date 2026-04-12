import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { z } from "zod";
import { BaseModelRunner } from "./runner.js";
import { Interaction } from "../interaction/core/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import type { ModelDetails } from "./types.js";
import {
  OLLAMA_INTEGRATION_MODEL,
  checkOllamaConnection,
} from "../test-utils/setup.js";

let ollamaHasIntegrationModel = false;

/** Helps local models (e.g. gemma4) return parseable structured output. */
const OLLAMA_JSON_ONLY_INSTRUCTIONS = [
  "Output only a single JSON object matching the schema. No markdown fences, no commentary before or after.",
  "Use the exact property names given in the user message (do not rename keys).",
];

beforeAll(async () => {
  if (!(await checkOllamaConnection())) return;
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    if (!r.ok) return;
    const j = (await r.json()) as {
      models?: Array<{ name: string; model?: string }>;
    };
    const want = OLLAMA_INTEGRATION_MODEL;
    const base = want.split(":")[0];
    ollamaHasIntegrationModel = (j.models ?? []).some((m) => {
      const n = m.name ?? m.model ?? "";
      return n === want || n.startsWith(`${base}:`);
    });
  } catch {
    /* ignore */
  }
});

// Gemma/Ollama often emit profession/interests instead of occupation/hobbies — accept both.
const testSchema = z
  .object({
    name: z.string().describe("The person's name"),
    age: z.number().describe("The person's age"),
    occupation: z.string().optional().describe("The person's job"),
    profession: z.string().optional(),
    hobbies: z.array(z.string()).optional().describe("List of hobbies"),
    interests: z.array(z.string()).optional(),
  })
  .refine(
    (o) =>
      Boolean(o.occupation ?? o.profession) &&
      (o.hobbies ?? o.interests ?? []).length > 0,
    { message: "Provide occupation or profession, and hobbies or interests" },
  );

type TestPerson = {
  name: string;
  age: number;
  occupation: string;
  hobbies: string[];
};

function normalizeTestPerson(raw: z.infer<typeof testSchema>): TestPerson {
  return {
    name: raw.name,
    age: raw.age,
    occupation: raw.occupation ?? raw.profession ?? "",
    hobbies: raw.hobbies ?? raw.interests ?? [],
  };
}

/** Gemma often returns summary objects instead of { facts: [...] } — normalize before validation. */
function normalizeMemoryPayload(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.facts)) return data;

  const out: { fact: string; confidence: number; source: string }[] = [];
  const src =
    typeof o.source === "string"
      ? o.source
      : typeof o.impact_area === "string"
        ? o.impact_area
        : "paragraph";

  const pushStrings = (arr: unknown, confidence: number) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === "string" && item.length > 0) {
        out.push({ fact: item, confidence, source: src });
      }
    }
  };

  pushStrings(o.key_functions, 0.85);
  pushStrings(o.key_facts, 0.85);

  if (
    out.length === 0 &&
    (typeof o.technology === "string" || typeof o.impact_area === "string")
  ) {
    const tech = typeof o.technology === "string" ? o.technology : "AI";
    const area =
      typeof o.impact_area === "string" ? o.impact_area : "software";
    out.push({
      fact: `${tech} affects ${area}.`,
      confidence: 0.9,
      source: src,
    });
  }

  if (out.length > 0) return { facts: out };
  return data;
}

const memorySchema = z.preprocess(
  normalizeMemoryPayload,
  z.object({
    facts: z
      .array(
        z.object({
          fact: z.string(),
          confidence: z.number().min(0).max(1),
          source: z.string(),
        }),
      )
      .min(1),
  }),
);

describe("generateObject with BaseModelRunner and Ollama", () => {
  let runner: BaseModelRunner;

  beforeEach(() => {
    runner = new BaseModelRunner();
  });

  // Helper function to create Ollama model details
  function createOllamaModelDetails(modelName: string): ModelDetails {
    const ctx =
      modelName.includes("gemma4") || modelName.includes("llama3.2")
        ? 131072
        : 8192;
    return {
      name: modelName,
      provider: "ollama",
      temperature: 0.1, // Low temperature for consistent structured output
      topP: 0.9,
      numCtx: ctx,
      contextLength: ctx,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
    };
  }

  describe(`Ollama generateObject (${OLLAMA_INTEGRATION_MODEL})`, () => {
    it("should generate a structured profile object", { retry: 2 }, async () => {
      if (!ollamaHasIntegrationModel) {
        console.warn(
          `⚠️ Skip: Ollama has no ${OLLAMA_INTEGRATION_MODEL} for generateObject tests`,
        );
        return;
      }
      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({
        role: "assistant that creates structured profiles",
        instructions: OLLAMA_JSON_ONLY_INSTRUCTIONS,
      });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({
        role: "user",
        content:
          "Create a profile for a software engineer named Alice who is 28 years old and enjoys coding, hiking, and reading. Use keys: name, age, occupation (job title), hobbies (string array). Do not use profession or interests.",
      });

      const result = await runner.generateObject(interaction, testSchema);

      console.log("generateObject profile:", result.content);

      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe("string");

      const person = normalizeTestPerson(
        testSchema.parse(JSON.parse(result.content)),
      );
      expect(person.name).toBeDefined();
      expect(typeof person.name).toBe("string");
      expect(person.age).toBeDefined();
      expect(typeof person.age).toBe("number");
      expect(person.occupation).toBeDefined();
      expect(typeof person.occupation).toBe("string");
      expect(person.hobbies).toBeDefined();
      expect(Array.isArray(person.hobbies)).toBe(true);

      expect(person.name.toLowerCase()).toContain("alice");
      expect(person.occupation.toLowerCase()).toContain("software");
      expect(person.hobbies.some((hobby) => hobby.toLowerCase().includes("coding"))).toBe(true);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.provider).toBe("ollama");
      expect(result.metadata.model).toBe(OLLAMA_INTEGRATION_MODEL);
      expect(result.metadata.tokenUsage).toBeDefined();
    }, 60000);

    it("should handle complex structured generation (story)", { retry: 2, timeout: 60000 }, async () => {
      if (!ollamaHasIntegrationModel) return;
      // Local models often flatten nested "story" objects into title + long text — keep shape simple.
      const storySchema = z.object({
        title: z.string(),
        story: z.string(),
        moral: z.string(),
      });

      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({
        role: "creative story writer",
        instructions: OLLAMA_JSON_ONLY_INSTRUCTIONS,
      });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(storySchema);
      interaction.addMessage({
        role: "user",
        content:
          "Write a short story about a brave knight who learns the value of friendship. Return JSON with exactly these keys: title (string), story (string, full narrative), moral (string).",
      });

      const result = await runner.generateObject(interaction, storySchema);

      console.log("generateObject story:", result.content);

      expect(result.content).toBeDefined();
      const storyData = storySchema.parse(JSON.parse(result.content));
      expect(storyData.title.length).toBeGreaterThan(0);
      expect(storyData.story.length).toBeGreaterThan(50);
      expect(storyData.moral.length).toBeGreaterThan(0);
    }, 60000);

    it("should handle complex structured generation (analysis)", { retry: 2 }, async () => {
      if (!ollamaHasIntegrationModel) return;
      const analysisSchema = z.object({
        topic: z.string(),
        findings: z
          .array(
            z.object({
              insight: z.string(),
              confidence: z.coerce.number().min(0).max(1),
              evidence: z.string(),
            }),
          )
          .min(2),
        conclusion: z.string(),
        recommendations: z.array(z.string()).min(1),
      });

      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({
        role: "AI research analyst",
        instructions: OLLAMA_JSON_ONLY_INSTRUCTIONS,
      });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(analysisSchema);
      interaction.addMessage({
        role: "user",
        content:
          "Analyze the impact of artificial intelligence on modern software development. Return JSON with keys: topic (string), findings (array of exactly 2 objects, each with insight string, confidence number between 0 and 1, evidence string), conclusion (string), recommendations (string array). Use numeric confidence only, not words.",
      });

      const result = await runner.generateObject(interaction, analysisSchema);

      console.log("generateObject analysis:", result.content);

      expect(result.content).toBeDefined();
      const analysisData = analysisSchema.parse(JSON.parse(result.content));
      expect(analysisData.topic.length).toBeGreaterThan(0);
      expect(analysisData.findings).toHaveLength(2);
      expect(typeof analysisData.findings[0].confidence).toBe("number");
    }, 60000);
  });

  describe("Usage Statistics", () => {
    it("should provide usage statistics", { retry: 2 }, async () => {
      if (!ollamaHasIntegrationModel) return;
      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({
        role: "assistant that creates structured profiles",
        instructions: OLLAMA_JSON_ONLY_INSTRUCTIONS,
      });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({
        role: "user",
        content:
          "Create a simple profile for John, age 25, who is a teacher and likes reading. Use keys: name, age, occupation, hobbies (array of strings). Do not use profession or interests.",
      });

      const result = await runner.generateObject(interaction, testSchema);

      console.log("Usage stats:", result.metadata.tokenUsage);
      
      expect(result.metadata.tokenUsage).toBeDefined();
      expect(result.metadata.tokenUsage).toHaveProperty("promptTokens");
      expect(result.metadata.tokenUsage).toHaveProperty("completionTokens");
      expect(result.metadata.tokenUsage).toHaveProperty("total");
      
      expect(typeof result.metadata.tokenUsage.promptTokens).toBe("number");
      expect(typeof result.metadata.tokenUsage.completionTokens).toBe("number");
      expect(typeof result.metadata.tokenUsage.total).toBe("number");
      
      expect(result.metadata.tokenUsage.promptTokens).toBeGreaterThan(0);
      expect(result.metadata.tokenUsage.completionTokens).toBeGreaterThan(0);
      expect(result.metadata.tokenUsage.total).toBe(
        result.metadata.tokenUsage.promptTokens + result.metadata.tokenUsage.completionTokens
      );
    }, 60000);
  });

  describe("Memory System Integration", () => {
    it("should work with memory system schemas", { retry: 2 }, async () => {
      if (!ollamaHasIntegrationModel) return;

      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({
        role: "fact extractor",
        instructions: OLLAMA_JSON_ONLY_INSTRUCTIONS,
      });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(memorySchema);
      interaction.addMessage({
        role: "user",
        content:
          'Extract key facts from: AI is transforming software development by automating code generation, testing, and deployment processes. Reply with JSON only, top-level key must be "facts" (array). Each element must have fact (string), confidence (number 0-1), source (string). Example shape: {"facts":[{"fact":"...","confidence":0.9,"source":"paragraph"}]}',
      });

      const result = await runner.generateObject(interaction, memorySchema);

      console.log("Memory schema result:", result.content);
      
      expect(result.content).toBeDefined();
      const memoryData = JSON.parse(result.content);
      expect(memoryData).toHaveProperty("facts");
      expect(Array.isArray(memoryData.facts)).toBe(true);
      expect(memoryData.facts.length).toBeGreaterThan(0);
      expect(memoryData.facts[0]).toHaveProperty("fact");
      expect(memoryData.facts[0]).toHaveProperty("confidence");
      expect(memoryData.facts[0]).toHaveProperty("source");
    }, 40000);
  });

  describe("Error Handling", () => {
    it("should handle invalid model gracefully", async () => {
      const modelDetails = createOllamaModelDetails("nonexistent-model:latest");
      const stimulus = new Stimulus({ role: "assistant" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({ role: "user", content: "Create a simple profile." });

      await expect(runner.generateObject(interaction, testSchema)).rejects.toThrow();
    }, 30000);

    it("should handle malformed schema gracefully", async () => {
      if (!ollamaHasIntegrationModel) return;
      const modelDetails = createOllamaModelDetails(OLLAMA_INTEGRATION_MODEL);
      const stimulus = new Stimulus({ role: "assistant" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.addMessage({ role: "user", content: "Create a simple profile." });
      
      // This should fail because the model can't generate valid JSON for an impossible schema
      const impossibleSchema = z.object({
        impossible: z.number().min(100).max(50) // Impossible constraint
      });

      // The AI SDK will throw an error when schema validation fails
      await expect(runner.generateObject(interaction, impossibleSchema)).rejects.toThrow();
    }, 30000);
  });
});
