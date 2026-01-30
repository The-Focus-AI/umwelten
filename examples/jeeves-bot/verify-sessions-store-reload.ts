#!/usr/bin/env node
/**
 * Verifies that Jeeves stores interactions to disk and can reload them.
 * Uses Claude-style JSONL (transcript.jsonl), session-parser (parseSessionFile,
 * summarizeSession), and meta.json. Writes to a temp sessions dir, then reloads.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempBase = join(tmpdir(), 'jeeves-verify-sessions-');
const tempDir = mkdtempSync(tempBase);

process.env.JEEVES_SESSIONS_DIR = tempDir;

const firstPrompt = 'verify store and reload';
const userLine = JSON.stringify({
  type: 'user',
  uuid: 'verify-user-uuid',
  timestamp: '2020-01-01T00:00:00.000Z',
  message: { role: 'user', content: firstPrompt },
});
const assistantLine = JSON.stringify({
  type: 'assistant',
  uuid: 'verify-assistant-uuid',
  timestamp: '2020-01-01T00:00:01.000Z',
  message: { role: 'assistant', content: 'Verified.' },
});
const transcriptContent = [userLine, assistantLine].join('\n');

async function main() {
  const {
    getOrCreateSession,
    updateSessionMetadata,
    listSessions,
    getSessionMetadata,
    getSessionDir,
  } = await import('./session-manager.js');
  const { parseSessionFile, summarizeSession } = await import(
    '../../src/sessions/session-parser.js'
  );

  // --- Store ---
  const created = await getOrCreateSession('cli');
  const sessionId = created.sessionId;
  const sessionDir = created.sessionDir;

  const transcriptPath = join(sessionDir, 'transcript.jsonl');
  writeFileSync(transcriptPath, transcriptContent, 'utf-8');
  await updateSessionMetadata(sessionId, {
    metadata: { firstPrompt, messageCount: 2 },
  });

  // --- Reload from disk ---
  const listed = await listSessions();
  const meta = await getSessionMetadata(sessionId);
  const resolvedDir = await getSessionDir(sessionId);
  const messages = await parseSessionFile(transcriptPath);
  const summary = summarizeSession(messages);

  // --- Assert ---
  const ok =
    listed.length >= 1 &&
    listed.some((s) => s.sessionId === sessionId) &&
    meta?.sessionId === sessionId &&
    meta?.metadata?.firstPrompt === firstPrompt &&
    resolvedDir === sessionDir &&
    messages.length >= 2 &&
    summary.firstMessage === firstPrompt &&
    summary.userMessages === 1 &&
    summary.assistantMessages === 1;

  if (!ok) {
    console.error('Verification failed.');
    console.error('listed', listed);
    console.error('meta', meta);
    console.error('resolvedDir', resolvedDir);
    console.error('messages.length', messages.length);
    console.error('summary', summary);
    process.exit(1);
  }

  console.log('OK: Interactions are stored directly to disk and reloaded correctly.');
  console.log('  - listSessions() loaded', listed.length, 'session(s) from disk');
  console.log('  - getSessionMetadata() loaded meta.json for', sessionId);
  console.log('  - getSessionDir() resolved session dir');
  console.log('  - transcript.jsonl parsed via session-parser; summary matches');
}

main()
  .then(() => {
    rmSync(tempDir, { recursive: true, force: true });
  })
  .catch((err) => {
    rmSync(tempDir, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  });
