import type { BaseProvider } from "./base.js";

interface ProviderEntry {
  create: (apiKey?: string, ...args: unknown[]) => BaseProvider;
  envVar?: string;  // e.g. "GOOGLE_GENERATIVE_AI_API_KEY"
  getModelUrl?: (name: string) => string | undefined;
}

const registry = new Map<string, ProviderEntry>();

export function registerProvider(name: string, entry: ProviderEntry): void {
  registry.set(name, entry);
}

export function getRegisteredProvider(name: string): ProviderEntry | undefined {
  return registry.get(name);
}

export function listRegisteredProviders(): string[] {
  return [...registry.keys()];
}
