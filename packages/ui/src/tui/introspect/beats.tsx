/**
 * Beats view for a single session.
 *
 * Uses `messagesToBeats()` directly from the transcript — no LLM required, no
 * digest needed. Gives you a fast "what were the turns and what did they do?"
 * view even for sessions that haven't been digested yet.
 *
 * Keys:
 *   j/k · up/down   move cursor
 *   space · pgdn    page down
 *   pgup            page up
 *   g · G           top · bottom
 *   q · esc         back to browser
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import type { SessionBrowserEntry } from '@umwelten/sessions/introspection/browse.js';
import type { NormalizedMessage } from '@umwelten/core/interaction/types/normalized-types.js';

export interface RunBeatsTuiOptions {
  entry: SessionBrowserEntry;
}

interface BeatRow {
  index: number;
  userPreview: string;
  toolSummary: string;
  messageCount: number;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

interface BeatsAppProps {
  entry: SessionBrowserEntry;
  beats: BeatRow[];
  /** Full beat details keyed by index, lazily formatted for the detail pane. */
  beatDetails: Map<number, string[]>;
  loadDuration: number;
}

function BeatsApp({
  entry,
  beats,
  beatDetails,
  loadDuration,
}: BeatsAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = Math.max(20, (stdout?.rows ?? 30) - 1);

  const [cursor, setCursor] = useState(0);
  const [windowTop, setWindowTop] = useState(0);

  const bounded = Math.max(0, Math.min(cursor, beats.length - 1));
  const current = beats[bounded];
  const bodyHeight = Math.max(8, rows - 6);
  const listHeight = bodyHeight;

  // Edge-scroll the list window.
  let effectiveTop = windowTop;
  const maxTop = Math.max(0, beats.length - listHeight);
  if (effectiveTop > maxTop) effectiveTop = maxTop;
  if (bounded < effectiveTop) effectiveTop = bounded;
  else if (bounded >= effectiveTop + listHeight)
    effectiveTop = bounded - listHeight + 1;
  useEffect(() => {
    if (effectiveTop !== windowTop) setWindowTop(effectiveTop);
  }, [effectiveTop, windowTop]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }
    if (input === 'j' || key.downArrow) {
      setCursor((c) => Math.min(beats.length - 1, c + 1));
    } else if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (input === ' ' || key.pageDown) {
      setCursor((c) => Math.min(beats.length - 1, c + bodyHeight));
    } else if (key.pageUp) {
      setCursor((c) => Math.max(0, c - bodyHeight));
    } else if (input === 'g') {
      setCursor(0);
    } else if (input === 'G') {
      setCursor(beats.length - 1);
    }
  });

  const visibleBeats = beats.slice(effectiveTop, effectiveTop + listHeight);
  const details = current ? beatDetails.get(current.index) ?? [] : [];

  return (
    <Box flexDirection="column" height={rows}>
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold>Beats · {entry.id.slice(0, 8)}</Text>
        <Text dimColor>
          {`  · ${beats.length} beat${beats.length === 1 ? '' : 's'} · ${entry.messageCount} msgs · parsed in ${formatDuration(loadDuration)}`}
        </Text>
      </Box>

      {/* Split: list left, current beat detail right */}
      <Box flexGrow={1}>
        {/* List */}
        <Box
          flexDirection="column"
          width={60}
          flexShrink={0}
          height={bodyHeight}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {visibleBeats.length === 0 ? (
            <Text dimColor>No beats found.</Text>
          ) : (
            visibleBeats.map((b) => {
              const selected = b.index === bounded;
              const prefix = selected ? '▶' : ' ';
              const idxStr = String(b.index + 1).padStart(3);
              const preview =
                b.userPreview.length > 30
                  ? b.userPreview.slice(0, 29).trimEnd() + '…'
                  : b.userPreview;
              const line = `${prefix} ${idxStr}. ${preview.padEnd(30)}  ${b.toolSummary}`;
              return (
                <Box key={b.index}>
                  <Text color={selected ? 'cyan' : undefined} bold={selected}>
                    {line}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Detail */}
        <Box
          flexDirection="column"
          flexGrow={1}
          height={bodyHeight}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {current ? (
            details.length === 0 ? (
              <Text dimColor>(empty beat)</Text>
            ) : (
              details.slice(0, bodyHeight - 1).map((line, i) => (
                <Box key={i}>
                  <Text>{line || ' '}</Text>
                </Box>
              ))
            )
          ) : (
            <Text dimColor>(no beat selected)</Text>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>{`beat ${bounded + 1}/${beats.length}  `}</Text>
        <Text dimColor>j/k · space/pgup · g/G · </Text>
        <Text color="cyan">q</Text>
        <Text dimColor> back</Text>
      </Box>
    </Box>
  );
}

/** Wrap text to a column width, preserving paragraphs. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width) {
        if (line) out.push(line);
        line = w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function runBeatsTui(opts: RunBeatsTuiOptions): Promise<void> {
  const { entry } = opts;

  // Load + compute beats up-front so the UI can show a stable list. Routes
  // through the adapter registry so pi/cursor/habitat sessions work too —
  // not just claude-format JSONL files on disk.
  const t0 = Date.now();
  const { adapterRegistry, initializeAdapters } = await import(
    '@umwelten/core/interaction/adapters/index.js'
  );
  const { detectSourceFromSessionId } = await import(
    '@umwelten/core/interaction/adapters/load-interaction.js'
  );
  const { messagesToBeats } = await import(
    '@umwelten/core/interaction/analysis/conversation-beats.js'
  );

  initializeAdapters();
  // Prefer the source the synthetic entry carries; fall back to prefix
  // detection on the sessionId for cases where the caller didn't carry it.
  const source = entry.source ?? detectSourceFromSessionId(entry.id);
  let normalized: NormalizedMessage[];
  if (source && source !== 'claude-code') {
    const adapter = adapterRegistry.get(source);
    const session = adapter ? await adapter.getSession(entry.id) : null;
    normalized = session?.messages ?? [];
  } else if (entry.filePath) {
    const { parseSessionFile, sessionMessagesToNormalized } = await import(
      '@umwelten/core/interaction/persistence/session-parser.js'
    );
    const raw = await parseSessionFile(entry.filePath);
    normalized = sessionMessagesToNormalized(raw);
  } else {
    normalized = [];
  }
  const rawBeats = messagesToBeats(normalized);
  const loadDuration = Date.now() - t0;

  const beats: BeatRow[] = rawBeats.map((b, i) => {
    const toolCounts = new Map<string, number>();
    for (const m of b.messages) {
      if (m.role === 'tool' && m.tool?.name) {
        toolCounts.set(m.tool.name, (toolCounts.get(m.tool.name) ?? 0) + 1);
      }
    }
    const tools = Array.from(toolCounts.entries())
      .map(([n, c]) => (c > 1 ? `${n}×${c}` : n))
      .slice(0, 4)
      .join(' ');
    return {
      index: i,
      userPreview: (b.userPreview ?? '').replace(/\s+/g, ' ').trim() || '(no prompt)',
      toolSummary: tools || '(no tools)',
      messageCount: b.messages.length,
    };
  });

  // Precompute detail lines per beat (cheap — just string manipulation).
  const beatDetails = new Map<number, string[]>();
  for (const [i, b] of rawBeats.entries()) {
    const lines: string[] = [];
    const userMsg = b.messages.find((m) => m.role === 'user');
    const userText = userMsg?.content?.replace(/\s+/g, ' ').trim() ?? b.userPreview ?? '';
    lines.push('USER');
    lines.push(...wrap(userText || '(empty)', 80).slice(0, 8).map((l) => `  ${l}`));

    const toolCounts = new Map<string, number>();
    for (const m of b.messages) {
      if (m.role === 'tool' && m.tool?.name) {
        toolCounts.set(m.tool.name, (toolCounts.get(m.tool.name) ?? 0) + 1);
      }
    }
    if (toolCounts.size > 0) {
      lines.push('');
      lines.push('TOOLS');
      for (const [name, count] of toolCounts.entries()) {
        lines.push(`  · ${name}${count > 1 ? ` ×${count}` : ''}`);
      }
    }

    const assistantMsgs = b.messages.filter((m) => m.role === 'assistant' && m.content.trim());
    const outcome = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : '';
    if (outcome) {
      lines.push('');
      lines.push('ASSISTANT');
      lines.push(...wrap(outcome, 80).slice(0, 12).map((l) => `  ${l}`));
    }

    lines.push('');
    lines.push(`(${b.messages.length} messages in this beat)`);
    beatDetails.set(i, lines);
  }

  if (beats.length === 0) {
    console.log(`No beats detected in ${entry.id.slice(0, 8)} (session has no user turns).`);
    return;
  }

  const app = (
    <BeatsApp
      entry={entry}
      beats={beats}
      beatDetails={beatDetails}
      loadDuration={loadDuration}
    />
  );

  const renderOpts = { stdin: process.stdin, stdout: process.stdout };
  if (process.env.UMWELTEN_TUI_NO_FULLSCREEN === '1') {
    const instance = render(app, renderOpts);
    await instance.waitUntilExit();
    return;
  }
  try {
    const { withFullScreen } = await import('fullscreen-ink');
    const ink = withFullScreen(app, renderOpts);
    ink.start();
    await ink.waitUntilExit();
  } catch {
    const instance = render(app, renderOpts);
    await instance.waitUntilExit();
  }
}
