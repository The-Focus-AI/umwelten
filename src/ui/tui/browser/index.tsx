/**
 * Session browser TUI: search, first messages, index summary/learnings.
 * Enter on a session = open detail (callback; typically run "sessions show <id>" elsewhere).
 */

import React from 'react';
import { render } from 'ink';
import { resolve } from 'node:path';
import { BrowserView } from './BrowserView.js';

export interface RunBrowserTuiOptions {
  projectPath: string;
  /** Called when user presses Enter on a session; can exit and print "umwelten sessions show <id>". */
  onSelectSession?: (sessionId: string) => void;
}

export async function runBrowserTui(options: RunBrowserTuiOptions): Promise<string | undefined> {
  const { projectPath: rawPath, onSelectSession } = options;
  const projectPath = resolve(rawPath);

  let selectedId: string | undefined;
  const handleSelect = (id: string) => {
    selectedId = id;
    onSelectSession?.(id);
  };

  const app = <BrowserView projectPath={projectPath} onSelectSession={handleSelect} />;

  const opts = { stdin: process.stdin, stdout: process.stdout };
  if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === '1') {
    const instance = render(app, opts);
    await instance.waitUntilExit();
    return selectedId;
  }
  try {
    const { withFullScreen } = await import('fullscreen-ink');
    const ink = withFullScreen(app, opts);
    ink.start();
    await ink.waitUntilExit();
    return selectedId;
  } catch {
    const instance = render(app, opts);
    await instance.waitUntilExit();
    return selectedId;
  }
}
