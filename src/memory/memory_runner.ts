import { SmartModelRunner, RunnerHook } from "../cognition/smart_runner.js";
import { MemoryStore } from "./memory_store.js";
import { ModelRunner } from "../cognition/types.js";
import { extractFacts } from "./extract_facts.js";
import { determineOperations } from "./determine_operations.js";
import { Fact } from "./types.js";
/**
 * Example: Memory-integrated runner configuration.
 * This wires up fact extraction and memory update as hooks.
 */

export interface MemoryRunnerConfig {
  baseRunner: ModelRunner;
  llmModel: string;
  memoryStore: MemoryStore;
}

export class MemoryRunner extends SmartModelRunner {
  constructor(config: MemoryRunnerConfig) {
    let extractedFacts: Fact[] = [];
    const model = { provider: "ollama", name: "gemma3:12b" };
    // During hook: extract facts and store in context
    const extractFactsHook: RunnerHook = async (conversation) => {  
      const facts = await extractFacts(conversation, model);
      extractedFacts = facts.facts;
    };

    // After hook: update memory with extracted facts
    const updateMemoryHook: RunnerHook = async (conversation) => {
      if (!extractedFacts || extractedFacts.length === 0) return;
      const existingMemories = await config.memoryStore.getFacts(
        conversation.userId
      );
      const opResult = await determineOperations(model, extractedFacts, existingMemories);
      // Apply memory operations
      for (const result of opResult.memory) {
        console.log("Memory operation:", result);
        if (result.event === "ADD") {
          await config.memoryStore.addFact(conversation.userId, {
            ...result.fact,
            id: result.id,
          });
        } else if (result.event === "UPDATE" && result.id) {
          await config.memoryStore.updateFact(
            conversation.userId,
            result.id,
            {
              ...result.fact,
              id: result.id,
            }
          );
        }
      }
    };

    super({
      baseRunner: config.baseRunner,
      duringHooks: [extractFactsHook],
      afterHooks: [updateMemoryHook],
    });
  }
}

export function createMemoryRunner(config: MemoryRunnerConfig): MemoryRunner {
  return new MemoryRunner(config);
}
