/**
 * Resolve an A2A contextId to its Source Session on disk.
 *
 * A2A conversations key their habitat session by the channel-key convention
 * `a2a:${contextId}` (a2a-handler.ts), which the session manager maps to a
 * session directory named exactly `contextId`. This module exposes that
 * mapping as a pure function over (sessionsDir, contextId) so the HTTP
 * routes — and anything else — can resolve a conversation without a server.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listHabitatTranscriptReadPaths } from '@umwelten/core/session-record/transcript-segments.js';
import type { HabitatSessionMetadata } from './types.js';

/**
 * Link to a native runtime's own session log (claude-sdk, pi), recorded in
 * the habitat session metadata by non-default runtimes. Read structurally
 * here because the writing side lands separately (issue #118).
 */
export interface NativeSessionRef {
  runtime: string;
  nativeSessionId: string;
  nativeSessionPath: string;
}

export interface ResolvedContext {
  contextId: string;
  sessionDir: string;
  /** Parsed meta.json, or null when missing/unreadable. */
  metadata: HabitatSessionMetadata | null;
  /** Frozen segments in order, then the live transcript. */
  transcriptReadPaths: string[];
  nativeSessionRef?: NativeSessionRef;
}

/**
 * contextIds become path segments; reject anything that could escape the
 * sessions directory before any filesystem access happens.
 */
function isSafeContextId(contextId: string): boolean {
  if (!contextId) return false;
  if (contextId === '.' || contextId === '..') return false;
  if (/[/\\\0]/.test(contextId)) return false;
  return true;
}

function asNativeSessionRef(value: unknown): NativeSessionRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const ref = value as Record<string, unknown>;
  if (
    typeof ref.runtime === 'string' &&
    typeof ref.nativeSessionId === 'string' &&
    typeof ref.nativeSessionPath === 'string'
  ) {
    return {
      runtime: ref.runtime,
      nativeSessionId: ref.nativeSessionId,
      nativeSessionPath: ref.nativeSessionPath,
    };
  }
  return undefined;
}

function extractNativeSessionRef(
  metadata: HabitatSessionMetadata | null,
): NativeSessionRef | undefined {
  if (!metadata) return undefined;
  const meta = metadata as unknown as Record<string, unknown>;
  return (
    asNativeSessionRef(meta.nativeSessionRef) ??
    asNativeSessionRef(
      (meta.metadata as Record<string, unknown> | undefined)?.nativeSessionRef,
    )
  );
}

/**
 * Resolve (sessionsDir, contextId) → session, or null when the contextId is
 * unsafe or no session exists for it. A directory counts as a session when it
 * has a readable meta.json or at least one transcript segment.
 */
export async function resolveContextSession(
  sessionsDir: string,
  contextId: string,
): Promise<ResolvedContext | null> {
  if (!isSafeContextId(contextId)) return null;

  const sessionDir = join(sessionsDir, contextId);

  let metadata: HabitatSessionMetadata | null;
  try {
    metadata = JSON.parse(
      await readFile(join(sessionDir, 'meta.json'), 'utf-8'),
    ) as HabitatSessionMetadata;
  } catch {
    metadata = null;
  }

  const transcriptReadPaths = await listHabitatTranscriptReadPaths(sessionDir);
  if (!metadata && transcriptReadPaths.length === 0) return null;

  return {
    contextId,
    sessionDir,
    metadata,
    transcriptReadPaths,
    nativeSessionRef: extractNativeSessionRef(metadata),
  };
}
