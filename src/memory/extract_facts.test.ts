import { describe, it, expect } from "vitest";
import { extractFacts } from "./extract_facts";
import { Interaction } from "../interaction/interaction";
import { Stimulus } from "../stimulus/stimulus";

describe("extractFacts (gemma3:27b)", () => {
  const model = { provider: "ollama", name: "gemma3:27b" };

  const createTestConversation = (messages: { role: "user" | "assistant"; content: string }[]) => {
    const stimulus = new Stimulus({ role: "test assistant" });
    const conversation = new Interaction(model, stimulus);
    messages.forEach(msg => conversation.addMessage(msg));
    return conversation;
  };

  it.skip("should extract facts from a simple conversation", async () => {
    const conversation = createTestConversation([
      { role: "user", content: "Hi, my name is John. I am a software engineer." },
      { role: "assistant", content: "Nice to meet you, John!" }
    ]);
    const result = await extractFacts(conversation, model);
    expect(Array.isArray(result.facts)).toBe(true);
    expect(result.facts.some(f => f.text.toLowerCase().includes("john"))).toBe(true);
    expect(result.facts.some(f => f.text.toLowerCase().includes("software engineer"))).toBe(true);
  });

  it("should return an empty array for irrelevant input", async () => {
    const conversation = createTestConversation([
      { role: "user", content: "There are branches in trees." },
      { role: "assistant", content: "Yes, that's true." }
    ]);
    const result = await extractFacts(conversation, model);
    expect(Array.isArray(result.facts)).toBe(true);
    expect(result.facts.length).toBe(0);
  });

  it.skip("should extract multiple facts from a complex message", async () => {
    const conversation = createTestConversation([
      { role: "user", content: "Yesterday, I had a meeting with John at 3pm. We discussed the new project." },
      { role: "assistant", content: "How did it go?" }
    ]);
    const result = await extractFacts(conversation, model);
    expect(Array.isArray(result.facts)).toBe(true);
    expect(result.facts.length).toBeGreaterThanOrEqual(2);
    expect(result.facts.some(f => f.text.toLowerCase().includes("meeting"))).toBe(true);
    expect(result.facts.some(f => f.text.toLowerCase().includes("project"))).toBe(true);
  });
});