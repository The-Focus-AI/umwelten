/**
 * Live progress TUI for the digest pipeline.
 *
 * Streams phases (loading → compacting → analyzing → extracting → saving)
 * without leaving Ink. Runs `digestSession()` in the background, pushes every
 * `DigestProgress` event into React state, and displays a running timeline.
 *
 * Exits automatically on completion (a few seconds after the final phase).
 * User can also press q to cancel early — the LLM call completes in the
 * background but the TUI returns so they can move on.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { resolve } from 'node:path';
import type { SessionBrowserEntry } from '@umwelten/evaluation/introspection/browse.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import type { DigestProgress } from '@umwelten/core/interaction/analysis/session-digester.js';
import { saveDigest } from '@umwelten/evaluation/introspection/browse.js';

export interface RunDigestLiveTuiOptions {
  projectPath: string;
  entry: SessionBrowserEntry;
  model: ModelDetails;
}

interface PhaseEvent {
  phase: DigestProgress['phase'];
  detail?: string;
  at: number; // ms since start
}

interface DigestLiveAppProps {
  entry: SessionBrowserEntry;
  model: ModelDetails;
  runDigest: (onProgress: (p: DigestProgress) => void) => Promise<{
    ok: boolean;
    error?: string;
    proposalCounts?: { facts: number; phases: number; beats: number; topics: number };
  }>;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const PHASE_LABELS: Record<DigestProgress['phase'], string> = {
  loading: 'Loading session',
  compacting: 'Compacting (segmenting + through-lines)',
  analyzing: 'Analyzing (topics, tags, phases)',
  extracting: 'Extracting facts',
  saving: 'Saving digest',
};

const PHASE_ORDER: DigestProgress['phase'][] = [
  'loading',
  'compacting',
  'analyzing',
  'extracting',
  'saving',
];

function DigestLiveApp({ entry, model, runDigest }: DigestLiveAppProps): React.ReactElement {
  const { exit } = useApp();
  const [startedAt] = useState(() => Date.now());
  const [events, setEvents] = useState<PhaseEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<'running' | 'done' | 'error' | 'cancelled'>(
    'running'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState<
    { facts: number; phases: number; beats: number; topics: number } | null
  >(null);

  // Tick a clock for "elapsed" display.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  // Launch the digest in the background.
  useEffect(() => {
    let cancelled = false;
    const onProgress = (p: DigestProgress) => {
      if (cancelled) return;
      setEvents((prev) => [...prev, { phase: p.phase, detail: p.detail, at: Date.now() - startedAt }]);
    };
    runDigest(onProgress)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setCounts(r.proposalCounts ?? null);
          setStatus('done');
        } else {
          setErrorMsg(r.error ?? 'unknown error');
          setStatus('error');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [runDigest, startedAt]);

  // Auto-close on done/error after a short pause so the user sees the result.
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      const t = setTimeout(() => exit(), status === 'done' ? 1500 : 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status, exit]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      setStatus('cancelled');
      exit();
    }
  });

  const elapsed = now - startedAt;

  // Determine which phase is "current" (last event) and which have completed.
  const lastPhase = events.length > 0 ? events[events.length - 1].phase : null;
  const completedPhases = new Set(
    events.slice(0, -1).map((e) => e.phase)
  );
  // Also mark everything before the current phase as complete (in PHASE_ORDER).
  if (lastPhase) {
    const lastIdx = PHASE_ORDER.indexOf(lastPhase);
    for (let i = 0; i < lastIdx; i++) completedPhases.add(PHASE_ORDER[i]);
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text bold color="cyan">
          Digesting session {entry.id.slice(0, 8)}
        </Text>
        <Text dimColor>
          {`  · ${entry.messageCount} messages · model ${model.provider}:${model.name}`}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{`elapsed ${formatElapsed(elapsed)}`}</Text>
        {status === 'running' && events.length === 0 && (
          <Text dimColor>  · starting…</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {PHASE_ORDER.map((phase) => {
          const done = completedPhases.has(phase);
          const active = phase === lastPhase && status === 'running';
          const mark = done ? '✓' : active ? '▸' : '·';
          const color = done ? 'green' : active ? 'cyan' : 'gray';
          const latestEventForPhase = [...events].reverse().find((e) => e.phase === phase);
          return (
            <Box key={phase}>
              <Text color={color}>{`${mark} `}</Text>
              <Text bold={active} color={color}>
                {PHASE_LABELS[phase].padEnd(42)}
              </Text>
              {latestEventForPhase?.detail && (
                <Text dimColor>{` ${latestEventForPhase.detail}`}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Tail of raw events for transparency */}
      {events.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Recent events:</Text>
          {events.slice(-6).map((e, i) => (
            <Box key={`${e.at}-${i}`}>
              <Text dimColor>{`  ${formatElapsed(e.at).padStart(5)} `}</Text>
              <Text color="cyan">{e.phase}</Text>
              {e.detail && <Text dimColor>{` · ${e.detail}`}</Text>}
            </Box>
          ))}
        </Box>
      )}

      {status === 'done' && counts && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">
            ✓ Digest saved
          </Text>
          <Text dimColor>
            {`  ${counts.topics} topics · ${counts.phases} phases · ${counts.beats} beats · ${counts.facts} facts`}
          </Text>
          <Text dimColor>  (returning to browser…)</Text>
        </Box>
      )}
      {status === 'error' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">✗ Digest failed</Text>
          {errorMsg && <Text dimColor>{`  ${errorMsg}`}</Text>}
          <Text dimColor>  (returning to browser…)</Text>
        </Box>
      )}
      {status === 'cancelled' && (
        <Text color="yellow">Cancelled — LLM call may still complete in background.</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press </Text>
        <Text color="cyan">q</Text>
        <Text dimColor> to return to browser {status === 'running' ? '(digest keeps running)' : ''}</Text>
      </Box>
    </Box>
  );
}

export async function runDigestLiveTui(opts: RunDigestLiveTuiOptions): Promise<void> {
  const { projectPath, entry, model } = opts;

  const runDigest = async (
    onProgress: (p: DigestProgress) => void
  ): Promise<{
    ok: boolean;
    error?: string;
    proposalCounts?: { facts: number; phases: number; beats: number; topics: number };
  }> => {
    try {
      const { digestSession } = await import(
        '@umwelten/core/interaction/analysis/session-digester.js'
      );
      // Build a SessionIndexEntry-ish shape to feed digestSession.
      const sessionIndexEntry = {
        sessionId: entry.id,
        fullPath: entry.filePath,
        fileMtime: entry.modifiedMs,
        firstPrompt: entry.firstPrompt,
        messageCount: entry.messageCount,
        created: entry.modifiedISO,
        modified: entry.modifiedISO,
        gitBranch: entry.gitBranch ?? '',
        projectPath: resolve(projectPath),
        isSidechain: false,
      };
      const projectName = projectPath.split('/').slice(-2).join('/');
      const digest = await digestSession(
        sessionIndexEntry,
        projectPath,
        projectName,
        model,
        onProgress
      );
      if (!digest) {
        return { ok: false, error: 'session too small or empty' };
      }
      // digestSession returns the digest object but does NOT persist it.
      onProgress({ phase: 'saving', detail: 'writing to ~/.umwelten/digests/' });
      await saveDigest(digest);
      return {
        ok: true,
        proposalCounts: {
          facts: digest.extractedFacts?.length ?? 0,
          phases: digest.phases?.length ?? 0,
          beats: digest.beats?.length ?? 0,
          topics: digest.analysis?.topics?.length ?? 0,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const app = <DigestLiveApp entry={entry} model={model} runDigest={runDigest} />;

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
