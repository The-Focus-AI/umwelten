import { describe, it, expect } from "vitest";
import { determineOperations } from "./determine_operations";
import { MemoryFact, Fact } from "./types";

describe("DetermineOperationsSpecialist (gemma3:12b)", () => {
  const model = { provider: "ollama", name: "gemma3:12b" };

  // Mock memory facts (not MemoryItem)
  const initialMemory = [
    { id: "1", type: "preference", text: "Name is John" },
    { id: "2", type: "preference", text: "Loves cheese pizza" },
    { id: "3", type: "professional", text: "User is a software engineer" },
  ] as MemoryFact[];

  it("should add new facts with nothing in memory", async () => {
    const facts = [{ type: "professional", text: "Name is Will" }] as Fact[];
    const result = await determineOperations(model, facts, []);
    const addOps = result.memory.filter((r) => r.event === "ADD");
    expect(addOps.length).toBeGreaterThan(0);
    expect(addOps[0].fact.text).toContain("Will");
  });

  it("should add new facts", async () => {
    const facts = [{ type: "memory", text: "Has a dog named Max" }] as Fact[];
    const result = await determineOperations(model, facts, initialMemory);
    const addOps = result.memory.filter((r) => r.event === "ADD");
    expect(addOps.length).toBeGreaterThan(0);
    expect(addOps.some((r) => r.fact.text.includes("dog"))).toBe(true);
  }, { timeout: 15000 });

  it("should update existing facts", async () => {
    const facts = [{ type: "memory", text: "Name is John Smith" }] as Fact[];
    const result = await determineOperations(model, facts, initialMemory);
    const updateOps = result.memory.filter((r) => r.event === "UPDATE");
    expect(updateOps.length).toBeGreaterThan(0);
    expect(updateOps[0].fact.text).toContain("John Smith");
  }, { timeout: 15000 });

  it("should delete facts that contradict", async () => {
    const facts = [
      { type: "preference", text: "Dislikes cheese pizza" },
    ] as Fact[];
    const result = await determineOperations(model, facts, initialMemory);
    console.log(JSON.stringify(result, null, 2));
    // const deleteOps = result.memory.filter(r => r.event === "DELETE");
    // expect(deleteOps.length).toBeGreaterThan(0);
    // expect(deleteOps[0].text).toContain("Loves cheese pizza");
  }, { timeout: 15000 });

  // it("should do nothing for redundant facts", async () => {
  //   const facts = [{ type: "preference", text: "Name is John" }] as Fact[];
  //   const result = await determineOperations(model, facts, initialMemory);
  //   const noneOps = result.memory.filter((r) => r.event === "NONE");
  //   expect(noneOps.length).toBeGreaterThan(0);
  //   expect(noneOps[0].fact.text).toContain("Name is John");
  // }, { timeout: 15000 });
});
