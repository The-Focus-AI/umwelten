/**
 * Interactive session TUI entry point.
 * Renders Ink app with fullscreen; supports live stdin, file, session ID, and overview.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { getAdapterRegistry } from '../../interaction/adapters/index.js';
import type { NormalizedSessionEntry, NormalizedSession } from '../../interaction/types/normalized-types.js';
import { InteractionStore } from '../../interaction/persistence/interaction-store.js';
import { App } from './App.js';

/** Default sessions directory (Jeeves-style native sessions) when JEEVES_SESSIONS_DIR is not set. */
function getDefaultSessionsDir(): string {
  const env = process.env.JEEVES_SESSIONS_DIR;
  if (env) return resolve(env);
  return join(homedir(), '.jeeves-sessions');
}

export interface RunTuiOptions {
  projectPath: string;
  /** When set, open this session JSONL file (optional watch). */
  filePath?: string;
  /** When set, open this session by ID. */
  sessionId?: string;
  /** When true, stdin is stream-json (live session). */
  hasStdin: boolean;
  /** Base path for native (Jeeves-style) session files. Defaults to ~/.jeeves-sessions. */
  sessionsDir?: string;
}

export async function runSessionTui(options: RunTuiOptions): Promise<void> {
  const { projectPath: rawPath, filePath, sessionId, hasStdin, sessionsDir } = options;
  const projectPath = resolve(rawPath);

  const registry = getAdapterRegistry();
  const store = new InteractionStore({ basePath: sessionsDir ?? getDefaultSessionsDir() });

  const onLoadSession = async (id: string): Promise<NormalizedSession | null> => {
    // If it's a UUID, try the store first
    if (/^[0-9a-f-]{36}$/.test(id) || id.startsWith('cli-')) {
      const session = await store.loadSession(id);
      if (session) return session;
    }

    const source = id.split(':')[0] as 'claude-code' | 'cursor';
    const adapter = registry.get(source);
    if (!adapter) return null;
    return adapter.getSession(id);
  };

  const loadInitialSessions = async (): Promise<NormalizedSessionEntry[]> => {
    // 1. Load native sessions
    const nativeSessions = await store.listSessions();

    // 2. Load adapter sessions
    const adapters = await registry.detectAdapters(projectPath);
    const adapterSessions: NormalizedSessionEntry[] = [];
    for (const adapter of adapters) {
      try {
        const result = await adapter.discoverSessions({
          projectPath,
          sortBy: 'modified',
          sortOrder: 'desc',
        });
        adapterSessions.push(...result.sessions);
      } catch {
        // skip adapter errors
      }
    }

    // Combine and sort
    const all = [...nativeSessions, ...adapterSessions].sort((a, b) => {
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });

    return all.slice(0, 50);
  };

  const app = (
    <App
      projectPath={projectPath}
      hasStdin={hasStdin}
      filePath={filePath}
      sessionId={sessionId}
      initialSessions={[]}
      loadInitialSessions={loadInitialSessions}
      onLoadSession={onLoadSession}
    />
  );

  const opts = { stdin: process.stdin, stdout: process.stdout };
  if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === '1') {
    render(app, opts);
    return;
  }
  try {
    const { withFullScreen } = await import('fullscreen-ink');
    withFullScreen(app, opts).start();
  } catch {
    render(app, opts);
  }
}
