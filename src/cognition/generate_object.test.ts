import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { BaseModelRunner } from "./runner.js";
import { Interaction } from "../interaction/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import type { ModelDetails } from "./types.js";

// Test schema for structured object generation
const testSchema = z.object({
  name: z.string().describe("The person's name"),
  age: z.number().describe("The person's age"),
  occupation: z.string().describe("The person's job"),
  hobbies: z.array(z.string()).describe("List of hobbies"),
});

type TestPerson = z.infer<typeof testSchema>;

describe("generateObject with BaseModelRunner and Ollama", () => {
  let runner: BaseModelRunner;

  beforeEach(() => {
    runner = new BaseModelRunner();
  });

  // Helper function to create Ollama model details
  function createOllamaModelDetails(modelName: string): ModelDetails {
    return {
      name: modelName,
      provider: "ollama",
      temperature: 0.1, // Low temperature for consistent structured output
      topP: 0.9,
      numCtx: 8192,
      contextLength: 8192,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
    };
  }

  describe("Gemma3 Model (12b)", () => {
    it("should generate a structured object with gemma3", async () => {
      const modelDetails = createOllamaModelDetails("gemma3:12b");
      const stimulus = new Stimulus({ role: "assistant that creates structured profiles" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({ role: "user", content: "Create a profile for a software engineer named Alice who is 28 years old and enjoys coding, hiking, and reading." });

      const result = await runner.generateObject(interaction, testSchema);

      console.log("Gemma3 result:", result.content);
      
      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe("string");
      
      const person = JSON.parse(result.content) as TestPerson;
      expect(person.name).toBeDefined();
      expect(typeof person.name).toBe("string");
      expect(person.age).toBeDefined();
      expect(typeof person.age).toBe("number");
      expect(person.occupation).toBeDefined();
      expect(typeof person.occupation).toBe("string");
      expect(person.hobbies).toBeDefined();
      expect(Array.isArray(person.hobbies)).toBe(true);
      
      // Verify the content matches the prompt
      expect(person.name.toLowerCase()).toContain("alice");
      expect(person.occupation.toLowerCase()).toContain("software");
      expect(person.hobbies.some(hobby => hobby.toLowerCase().includes("coding"))).toBe(true);
      
      // Verify metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata.provider).toBe("ollama");
      expect(result.metadata.model).toBe("gemma3:12b");
      expect(result.metadata.tokenUsage).toBeDefined();
    }, 60000);

    it("should handle complex structured generation with gemma3", async () => {
      const complexSchema = z.object({
        story: z.object({
          title: z.string(),
          characters: z.array(z.object({
            name: z.string(),
            role: z.string(),
            traits: z.array(z.string())
          })),
          plot: z.string(),
          moral: z.string()
        })
      });

      const modelDetails = createOllamaModelDetails("gemma3:12b");
      const stimulus = new Stimulus({ role: "creative story writer" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(complexSchema);
      interaction.addMessage({ role: "user", content: "Write a short story about a brave knight who learns the value of friendship. Include 2 characters with their traits." });

      const result = await runner.generateObject(interaction, complexSchema);

      console.log("Gemma3 complex result:", result.content);
      
      expect(result.content).toBeDefined();
      const storyData = JSON.parse(result.content);
      expect(storyData).toHaveProperty("story");
      expect(storyData.story).toHaveProperty("title");
      expect(storyData.story).toHaveProperty("characters");
      expect(Array.isArray(storyData.story.characters)).toBe(true);
      expect(storyData.story.characters.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe("Qwen3 Model (14b)", () => {
    it("should generate a structured object with qwen3", async () => {
      const modelDetails = createOllamaModelDetails("qwen3:latest");
      const stimulus = new Stimulus({ role: "assistant that creates structured profiles" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({ role: "user", content: "Create a profile for a data scientist named Bob who is 32 years old and enjoys machine learning, yoga, and cooking." });

      const result = await runner.generateObject(interaction, testSchema);

      console.log("Qwen3 result:", result.content);
      
      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe("string");
      
      const person = JSON.parse(result.content) as TestPerson;
      expect(person.name).toBeDefined();
      expect(typeof person.name).toBe("string");
      expect(person.age).toBeDefined();
      expect(typeof person.age).toBe("number");
      expect(person.occupation).toBeDefined();
      expect(typeof person.occupation).toBe("string");
      expect(person.hobbies).toBeDefined();
      expect(Array.isArray(person.hobbies)).toBe(true);
      
      // Verify the content matches the prompt
      expect(person.name.toLowerCase()).toContain("bob");
      expect(person.occupation.toLowerCase()).toContain("data");
      expect(person.hobbies.some(hobby => hobby.toLowerCase().includes("machine"))).toBe(true);
    }, 60000);

    it("should handle complex structured generation with qwen3", async () => {
      const complexSchema = z.object({
        analysis: z.object({
          topic: z.string(),
          findings: z.array(z.object({
            insight: z.string(),
            confidence: z.number().min(0).max(1),
            evidence: z.string()
          })),
          conclusion: z.string(),
          recommendations: z.array(z.string())
        })
      });

      const modelDetails = createOllamaModelDetails("qwen3:latest");
      const stimulus = new Stimulus({ role: "AI research analyst" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(complexSchema);
      interaction.addMessage({ role: "user", content: "Analyze the impact of artificial intelligence on modern software development. Provide 2 key insights with confidence levels." });

      const result = await runner.generateObject(interaction, complexSchema);

      console.log("Qwen3 complex result:", result.content);
      
      expect(result.content).toBeDefined();
      const analysisData = JSON.parse(result.content);
      expect(analysisData).toHaveProperty("analysis");
      expect(analysisData.analysis).toHaveProperty("topic");
      expect(analysisData.analysis).toHaveProperty("findings");
      expect(Array.isArray(analysisData.analysis.findings)).toBe(true);
      expect(analysisData.analysis.findings.length).toBeGreaterThan(0);
      expect(analysisData.analysis.findings[0]).toHaveProperty("confidence");
      expect(typeof analysisData.analysis.findings[0].confidence).toBe("number");
    }, 60000);
  });

  describe("Usage Statistics", () => {
    it("should provide usage statistics", async () => {
      const modelDetails = createOllamaModelDetails("gemma3:12b");
      const stimulus = new Stimulus({ role: "assistant that creates structured profiles" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(testSchema);
      interaction.addMessage({ role: "user", content: "Create a simple profile for John, age 25, who is a teacher and likes reading." });

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
    }, 30000);
  });

  describe("Memory System Integration", () => {
    it("should work with memory system schemas", async () => {
      // Test with a schema similar to what the memory system uses
      const memorySchema = z.object({
        facts: z.array(z.object({
          fact: z.string(),
          confidence: z.number().min(0).max(1),
          source: z.string()
        }))
      });

      const modelDetails = createOllamaModelDetails("gemma3:12b");
      const stimulus = new Stimulus({ role: "fact extractor" });

      const interaction = new Interaction(modelDetails, stimulus);
      interaction.setOutputFormat(memorySchema);
      interaction.addMessage({ role: "user", content: "Extract key facts about artificial intelligence from this text: AI is transforming software development by automating code generation, testing, and deployment processes." });

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
      const modelDetails = createOllamaModelDetails("gemma3:12b");
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
