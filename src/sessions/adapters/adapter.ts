/**
 * Session adapter interface for multi-source support
 *
 * Each session source (Claude Code, Cursor, etc.) implements this interface
 * to provide normalized access to session data.
 */

import type {
  SessionSource,
  NormalizedSession,
  NormalizedSessionEntry,
  NormalizedMessage,
  SessionDiscoveryOptions,
  SessionDiscoveryResult,
} from '../normalized-types.js';

/**
 * Session adapter interface - implemented by each source
 */
export interface SessionAdapter {
  /** Source identifier */
  readonly source: SessionSource;

  /** Human-readable name */
  readonly displayName: string;

  /**
   * Get the base location where this source stores session data
   * e.g., "~/.claude/projects/" for Claude Code
   */
  getSourceLocation(): string;

  /**
   * Check if this adapter can handle sessions for a given project path
   */
  canHandle(projectPath: string): Promise<boolean>;

  /**
   * Discover all projects that have sessions from this source
   */
  discoverProjects(): Promise<string[]>;

  /**
   * Discover sessions for a project
   */
  discoverSessions(options?: SessionDiscoveryOptions): Promise<SessionDiscoveryResult>;

  /**
   * Get a single session by ID (lightweight, without messages)
   */
  getSessionEntry(sessionId: string): Promise<NormalizedSessionEntry | null>;

  /**
   * Get a full session with all messages
   */
  getSession(sessionId: string): Promise<NormalizedSession | null>;

  /**
   * Get messages for a session (useful for streaming/pagination)
   */
  getMessages(sessionId: string): Promise<NormalizedMessage[]>;

  /**
   * Check if the source has any sessions for a project
   */
  hasSessionsForProject(projectPath: string): Promise<boolean>;
}

/**
 * Adapter factory function type
 */
export type AdapterFactory = () => SessionAdapter;

/**
 * Registry for managing multiple session adapters
 */
export class AdapterRegistry {
  private adapters: Map<SessionSource, SessionAdapter> = new Map();
  private factories: Map<SessionSource, AdapterFactory> = new Map();

  /**
   * Register an adapter factory
   */
  registerFactory(source: SessionSource, factory: AdapterFactory): void {
    this.factories.set(source, factory);
  }

  /**
   * Register an adapter instance
   */
  register(adapter: SessionAdapter): void {
    this.adapters.set(adapter.source, adapter);
  }

  /**
   * Get an adapter by source, creating from factory if needed
   */
  get(source: SessionSource): SessionAdapter | undefined {
    let adapter = this.adapters.get(source);
    if (!adapter) {
      const factory = this.factories.get(source);
      if (factory) {
        adapter = factory();
        this.adapters.set(source, adapter);
      }
    }
    return adapter;
  }

  /**
   * Get all registered adapters
   */
  getAll(): SessionAdapter[] {
    // Ensure all factories have been instantiated
    for (const [source, factory] of this.factories) {
      if (!this.adapters.has(source)) {
        this.adapters.set(source, factory());
      }
    }
    return Array.from(this.adapters.values());
  }

  /**
   * Get all registered source types
   */
  getSources(): SessionSource[] {
    const sources = new Set<SessionSource>();
    for (const source of this.adapters.keys()) {
      sources.add(source);
    }
    for (const source of this.factories.keys()) {
      sources.add(source);
    }
    return Array.from(sources);
  }

  /**
   * Auto-detect which adapter(s) can handle a project path
   */
  async detectAdapters(projectPath: string): Promise<SessionAdapter[]> {
    const results: SessionAdapter[] = [];
    for (const adapter of this.getAll()) {
      if (await adapter.canHandle(projectPath)) {
        results.push(adapter);
      }
    }
    return results;
  }

  /**
   * Get the primary adapter for a project (first one that can handle it)
   */
  async getAdapterForProject(projectPath: string): Promise<SessionAdapter | undefined> {
    const adapters = await this.detectAdapters(projectPath);
    return adapters[0];
  }

  /**
   * Discover sessions from all sources for a project
   */
  async discoverAllSessions(
    options?: SessionDiscoveryOptions
  ): Promise<Map<SessionSource, SessionDiscoveryResult>> {
    const results = new Map<SessionSource, SessionDiscoveryResult>();

    for (const adapter of this.getAll()) {
      try {
        const result = await adapter.discoverSessions(options);
        if (result.sessions.length > 0) {
          results.set(adapter.source, result);
        }
      } catch (error) {
        // Log but don't fail - some adapters may not be available
        console.warn(`Failed to discover sessions from ${adapter.source}:`, error);
      }
    }

    return results;
  }
}

/**
 * Global adapter registry instance
 */
export const adapterRegistry = new AdapterRegistry();
