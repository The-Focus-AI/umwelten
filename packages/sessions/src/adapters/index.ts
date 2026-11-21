/**
 * Session adapters — unified read-only access to sessions across Pi JSONL v3,
 * Pi Durable SQLite (`habitat.sqlite`), Claude Code, and Cursor.
 */

export * from "./adapter.js";
export * from "./claude-code-adapter.js";
export * from "./cursor-adapter.js";
export * from "./pi-adapter.js";
export * from "./pi-durable-adapter.js";

import { adapterRegistry } from "./adapter.js";
import { createClaudeCodeAdapter } from "./claude-code-adapter.js";
import { createCursorAdapter } from "./cursor-adapter.js";
import { PiSessionAdapter } from "./pi-adapter.js";
import { createPiDurableSessionAdapter } from "./pi-durable-adapter.js";

export function initializeAdapters(): void {
  adapterRegistry.registerFactory("claude-code", createClaudeCodeAdapter);
  adapterRegistry.registerFactory("cursor", createCursorAdapter);
  adapterRegistry.register(new PiSessionAdapter());
  adapterRegistry.registerFactory("pi-durable", createPiDurableSessionAdapter);
}

export function getAdapterRegistry() {
  if (adapterRegistry.getSources().length === 0) {
    initializeAdapters();
  }
  return adapterRegistry;
}
