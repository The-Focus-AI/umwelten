import { describe, it, expect, beforeEach } from "vitest";
import { generateObject } from "ai";
import { z } from "zod";
import { ollama } from "ai-sdk-ollama";

// Test schema for structured object generation
const testSchema = z.object({
  name: z.string().describe("The person's name"),
  age: z.number().describe("The person's age"),
  occupation: z.string().describe("The person's job"),
  hobbies: z.array(z.string()).describe("List of hobbies"),
});

type TestPerson = z.infer<typeof testSchema>;

describe("generateObject with AI SDK v5", () => {
  // Use smaller, faster models for testing
  const gemma3Model = ollama("gemma3:12b"); // 8.1GB - faster than 27b
  const gptOssModel = ollama("gpt-oss:20b"); // 13GB - much faster than 120b

  describe("Gemma3 Model (12b)", () => {
    it("should generate a structured object with gemma3", async () => {
      const prompt = "Create a profile for a software engineer named Alice who is 28 years old and enjoys coding, hiking, and reading.";

      const result = await generateObject({
        model: gemma3Model,
        prompt,
        schema: testSchema,
      });

      console.log("Gemma3 result:", result.object);
      
      expect(result.object).toBeDefined();
      expect(typeof result.object).toBe("object");
      
      const person = result.object as TestPerson;
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
    }, 30000);

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

      const prompt = "Write a short story about a brave knight who learns the value of friendship. Include 2 characters with their traits.";

      const result = await generateObject({
        model: gemma3Model,
        prompt,
        schema: complexSchema,
      });

      console.log("Gemma3 complex result:", JSON.stringify(result.object, null, 2));
      
      expect(result.object).toBeDefined();
      expect(result.object).toHaveProperty("story");
      expect(result.object.story).toHaveProperty("title");
      expect(result.object.story).toHaveProperty("characters");
      expect(Array.isArray(result.object.story.characters)).toBe(true);
      expect(result.object.story.characters.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe("GPT-OSS Model (20b)", () => {
    it("should generate a structured object with gpt-oss", async () => {
      const prompt = "Create a profile for a data scientist named Bob who is 32 years old and enjoys machine learning, yoga, and cooking.";

      const result = await generateObject({
        model: gptOssModel,
        prompt,
        schema: testSchema,
      });

      console.log("GPT-OSS result:", result.object);
      
      expect(result.object).toBeDefined();
      expect(typeof result.object).toBe("object");
      
      const person = result.object as TestPerson;
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
    }, 30000);

    it("should handle complex structured generation with gpt-oss", async () => {
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

      const prompt = "Analyze the impact of artificial intelligence on modern software development. Provide 2 key insights with confidence levels.";

      const result = await generateObject({
        model: gptOssModel,
        prompt,
        schema: complexSchema,
      });

      console.log("GPT-OSS complex result:", JSON.stringify(result.object, null, 2));
      
      expect(result.object).toBeDefined();
      expect(result.object).toHaveProperty("analysis");
      expect(result.object.analysis).toHaveProperty("topic");
      expect(result.object.analysis).toHaveProperty("findings");
      expect(Array.isArray(result.object.analysis.findings)).toBe(true);
      expect(result.object.analysis.findings.length).toBeGreaterThan(0);
      expect(result.object.analysis.findings[0]).toHaveProperty("confidence");
      expect(typeof result.object.analysis.findings[0].confidence).toBe("number");
    }, 30000);
  });

  describe("Usage Statistics", () => {
    it("should provide usage statistics", async () => {
      const result = await generateObject({
        model: gemma3Model,
        prompt: "Create a simple profile for John, age 25, who is a teacher and likes reading.",
        schema: testSchema,
      });

      console.log("Usage stats:", result.usage);
      
      expect(result.usage).toBeDefined();
      expect(result.usage).toHaveProperty("inputTokens");
      expect(result.usage).toHaveProperty("outputTokens");
      expect(result.usage).toHaveProperty("totalTokens");
      
      expect(typeof result.usage.inputTokens).toBe("number");
      expect(typeof result.usage.outputTokens).toBe("number");
      expect(typeof result.usage.totalTokens).toBe("number");
      
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBe((result.usage.inputTokens || 0) + (result.usage.outputTokens || 0));
    }, 15000);
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

      const prompt = "Extract key facts about artificial intelligence from this text: AI is transforming software development by automating code generation, testing, and deployment processes.";

      const result = await generateObject({
        model: gemma3Model,
        prompt,
        schema: memorySchema,
      });

      console.log("Memory schema result:", JSON.stringify(result.object, null, 2));
      
      expect(result.object).toBeDefined();
      expect(result.object).toHaveProperty("facts");
      expect(Array.isArray(result.object.facts)).toBe(true);
      expect(result.object.facts.length).toBeGreaterThan(0);
      expect(result.object.facts[0]).toHaveProperty("fact");
      expect(result.object.facts[0]).toHaveProperty("confidence");
      expect(result.object.facts[0]).toHaveProperty("source");
    }, 20000);
  });
});
