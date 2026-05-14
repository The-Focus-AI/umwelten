/**
 * Session adapters module
 *
 * Provides unified access to sessions from multiple AI coding tools.
 */

export * from "./adapter.js";
export * from "./claude-code-adapter.js";
export * from "./cursor-adapter.js";
export * from "./pi-adapter.js";

import { adapterRegistry } from "./adapter.js";
import { createClaudeCodeAdapter } from "./claude-code-adapter.js";
import { createCursorAdapter } from "./cursor-adapter.js";
import { PiSessionAdapter } from "./pi-adapter.js";

/**
 * Initialize the adapter registry with all available adapters
 */
export function initializeAdapters(): void {
	// Register Claude Code adapter
	adapterRegistry.registerFactory("claude-code", createClaudeCodeAdapter);

	// Register Cursor adapter
	adapterRegistry.registerFactory("cursor", createCursorAdapter);

	// Register Pi adapter
	adapterRegistry.register(new PiSessionAdapter());
}

/**
 * Get the global adapter registry (auto-initializes if needed)
 */
export function getAdapterRegistry() {
	// Ensure adapters are initialized
	if (adapterRegistry.getSources().length === 0) {
		initializeAdapters();
	}
	return adapterRegistry;
}
