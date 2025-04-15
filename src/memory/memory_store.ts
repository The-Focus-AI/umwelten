/**
 * MemoryStore interface and in-memory implementation for storing user facts.
 * This is designed to be used by runner hooks and specialists.
 */

import { MemoryFact } from "./types.js";

export interface MemoryStore {
  getFacts(userId: string): Promise<MemoryFact[]>;
  addFact(userId: string, fact: MemoryFact): Promise<MemoryFact>;
  updateFact(userId: string, factId: string, fact: MemoryFact): Promise<MemoryFact | undefined>;
  deleteFact(userId: string, factId: string): Promise<boolean>;
  setFacts(userId: string, facts: MemoryFact[]): Promise<void>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private store: Map<string, MemoryFact[]> = new Map();

  async getFacts(userId: string): Promise<MemoryFact[]> {
    return this.store.get(userId) || [];
  }

  async addFact(userId: string, fact: MemoryFact): Promise<MemoryFact> {
    const facts = this.store.get(userId) || [];
    facts.push(fact);
    this.store.set(userId, facts);
    return fact;
  }

  async updateFact(userId: string, factId: string, fact: MemoryFact): Promise<MemoryFact | undefined> {
    const facts = this.store.get(userId) || [];
    const idx = facts.findIndex(f => f.id === factId);
    if (idx !== -1) {
      facts[idx] = fact;
      this.store.set(userId, facts);
      return facts[idx];
    }
    return undefined;
  }

  async deleteFact(userId: string, factId: string): Promise<boolean> {
    const facts = this.store.get(userId) || [];
    const idx = facts.findIndex(f => f.id === factId);
    if (idx !== -1) {
      facts.splice(idx, 1);
      this.store.set(userId, facts);
      return true;
    }
    return false;
  }

  async setFacts(userId: string, facts: MemoryFact[]): Promise<void> {
    this.store.set(userId, facts);
  }
}