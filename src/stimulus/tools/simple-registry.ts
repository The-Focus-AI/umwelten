import { tool } from 'ai';
import { z } from 'zod';

// Simple registry for Vercel AI SDK tools
class SimpleToolRegistry {
  private tools = new Map<string, any>();

  register(name: string, toolDefinition: any): void {
    if (this.tools.has(name)) {
      console.warn(`Tool '${name}' is already registered. Overwriting.`);
    }
    this.tools.set(name, toolDefinition);
  }

  get(name: string): any | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  getAll(): Record<string, any> {
    return Object.fromEntries(this.tools);
  }

  clear(): void {
    this.tools.clear();
  }
}

// Global registry instance
export const toolRegistry = new SimpleToolRegistry();

// Helper functions
export function registerTool(name: string, toolDefinition: any): void {
  toolRegistry.register(name, toolDefinition);
}

export function getTool(name: string): any | undefined {
  return toolRegistry.get(name);
}

export function listTools(): string[] {
  return toolRegistry.list();
}

export function getAllTools(): Record<string, any> {
  return toolRegistry.getAll();
}
