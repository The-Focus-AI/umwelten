/**
 * Interactive session TUI entry point.
 * Renders Ink app with fullscreen; supports live stdin, file, session ID, and overview.
 */

import { render } from 'ink';
import React from 'react';
import { resolve } from 'node:path';
import { getAdapterRegistry } from '../../sessions/adapters/index.js';
import type { NormalizedSessionEntry, NormalizedSession } from '../../sessions/normalized-types.js';
import { App } from './App.js';

export interface RunTuiOptions {
  projectPath: string;
  /** When set, open this session JSONL file (optional watch). */
  filePath?: string;
  /** When set, open this session by ID. */
  sessionId?: string;
  /** When true, stdin is stream-json (live session). */
  hasStdin: boolean;
}

export async function runSessionTui(options: RunTuiOptions): Promise<void> {
  const { projectPath: rawPath, filePath, sessionId, hasStdin } = options;
  const projectPath = resolve(rawPath);

  const registry = getAdapterRegistry();

  const onLoadSession = async (id: string): Promise<NormalizedSession | null> => {
    const source = id.split(':')[0] as 'claude-code' | 'cursor';
    const adapter = registry.get(source);
    if (!adapter) return null;
    return adapter.getSession(id);
  };

  const loadInitialSessions = async (): Promise<NormalizedSessionEntry[]> => {
    const adapters = await registry.detectAdapters(projectPath);
    const allSessions: NormalizedSessionEntry[] = [];
    for (const adapter of adapters) {
      try {
        const result = await adapter.discoverSessions({
          projectPath,
          sortBy: 'modified',
          sortOrder: 'desc',
        });
        allSessions.push(...result.sessions);
      } catch {
        // skip adapter errors
      }
    }
    return allSessions.slice(0, 50);
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
