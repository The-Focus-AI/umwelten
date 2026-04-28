import React from 'react';
import { render } from 'ink';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { BrowseApp, type BrowseIntent } from './BrowseApp.js';
import { buildBrowse } from '../../../introspection/browse.js';
import type { ModelDetails } from '../../../cognition/types.js';

export interface RunBrowseTuiOptions {
  projectPath: string;
  targetPath: string;
  sessionsDir?: string;
  model: ModelDetails;
}

/**
 * Show the browse TUI and resolve with the user's exit intent.
 * The TUI tears down before the promise resolves, so follow-up actions
 * (LLM calls, launching another TUI) run with a clean terminal.
 */
async function showBrowseTui(args: {
  projectPath: string;
  targetPath: string;
  entries: Awaited<ReturnType<typeof buildBrowse>>['entries'];
  runCount: number;
}): Promise<BrowseIntent> {
  let intent: BrowseIntent = { kind: 'none' };

  const app = (
    <BrowseApp
      projectPath={args.projectPath}
      targetPath={args.targetPath}
      entries={args.entries}
      runCount={args.runCount}
      onExit={(i) => {
        intent = i;
      }}
    />
  );

  const renderOpts = { stdin: process.stdin, stdout: process.stdout };
  if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === '1') {
    const instance = render(app, renderOpts);
    await instance.waitUntilExit();
    return intent;
  }
  try {
    const { withFullScreen } = await import('fullscreen-ink');
    const ink = withFullScreen(app, renderOpts);
    ink.start();
    await ink.waitUntilExit();
    return intent;
  } catch {
    const instance = render(app, renderOpts);
    await instance.waitUntilExit();
    return intent;
  }
}

export async function runIntrospectBrowseTui(opts: RunBrowseTuiOptions): Promise<void> {
  const { projectPath: rawProject, targetPath: rawTarget, sessionsDir, model } = opts;
  const projectPath = resolve(rawProject);
  const targetPath = resolve(rawTarget);

  // Event loop: show browse → act on intent → rebuild data → show browse again.
  // Keeps the terminal coherent across digest/detail launches.
  while (true) {
    const { entries, runs } = await buildBrowse({ projectPath, sessionsDir });

    if (entries.length === 0) {
      console.log(chalk.yellow('No sessions found for this project.'));
      console.log(chalk.dim(`Project: ${projectPath}`));
      if (sessionsDir) console.log(chalk.dim(`Sessions dir: ${sessionsDir}`));
      return;
    }

    const intent = await showBrowseTui({
      projectPath,
      targetPath,
      entries,
      runCount: runs.length,
    });

    if (intent.kind === 'none') return;

    if (intent.kind === 'transcript') {
      const { runSessionTui } = await import('../index.js');
      await runSessionTui({
        projectPath,
        filePath: intent.entry.filePath,
        hasStdin: false,
      });
      // Loop back to browse after transcript viewer exits.
      continue;
    }

    if (intent.kind === 'detail') {
      const { runDigestDetailTui } = await import('./detail.js');
      await runDigestDetailTui({
        projectPath,
        targetPath,
        entry: intent.entry,
        model,
      });
      continue;
    }

    if (intent.kind === 'digest') {
      const { runDigestLiveTui } = await import('./digest-live.js');
      await runDigestLiveTui({
        projectPath,
        entry: intent.entry,
        model,
      });
      continue;
    }

    if (intent.kind === 'beats') {
      const { runBeatsTui } = await import('./beats.js');
      try {
        await runBeatsTui({ entry: intent.entry });
      } catch (err) {
        console.error(
          chalk.red(`[beats] failed: ${err instanceof Error ? err.message : String(err)}`)
        );
      }
      continue;
    }
  }
}
