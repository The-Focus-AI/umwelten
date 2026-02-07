/**
 * Read session JSONL from a file; optionally watch for appends (streaming file).
 * Emits NormalizedMessage[] and liveness ("writing" when recent appends, "ended" when stale).
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { watch } from 'node:fs';
import type { NormalizedMessage } from '../../interaction/types/normalized-types.js';
import { parseJSONLLine } from '../../interaction/persistence/session-parser.js';
import type { SessionMessage } from '../../interaction/types/types.js';
import { streamLineToEvent } from './stream-to-normalized.js';

export type FileSessionLiveness = 'reading' | 'writing' | 'ended';

const STALE_MS = 3000;

export interface FileSessionCallbacks {
  onMessages: (messages: NormalizedMessage[]) => void;
  onLiveness?: (liveness: FileSessionLiveness) => void;
  onInit?: (sessionId?: string, cwd?: string) => void;
}

/**
 * Read a JSONL session file and call onMessages for each batch of normalized messages.
 * Optionally watch the file for appends and emit new messages + liveness.
 */
export async function readSessionFile(
  filePath: string,
  callbacks: FileSessionCallbacks,
  options: { watch: boolean } = { watch: false }
): Promise<void> {
  const messageIndex = { count: 0 };
  let lastAppendTime = 0;
  let watcher: ReturnType<typeof watch> | null = null;
  let lineCount = 0;

  function processLine(line: string): NormalizedMessage[] {
    const raw = parseJSONLLine(line) as SessionMessage | null;
    if (!raw) return [];
    const event = streamLineToEvent(raw, messageIndex);
    if (event?.type === 'init' && callbacks.onInit) {
      callbacks.onInit(event.sessionId, event.cwd);
    }
    if (event?.type === 'message') return event.messages;
    return [];
  }

  async function readAll(): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineCount++;
      messages.push(...processLine(line));
    }
    return messages;
  }

  async function readFromLine(startLine: number): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let current = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (current >= startLine) messages.push(...processLine(line));
      current++;
    }
    lineCount = current;
    return messages;
  }

  callbacks.onLiveness?.('reading');

  const initial = await readAll();
  if (initial.length > 0) callbacks.onMessages(initial);

  if (!options.watch) {
    callbacks.onLiveness?.('ended');
    return;
  }

  lastAppendTime = Date.now();
  callbacks.onLiveness?.('writing');

  const staleTimer = setInterval(() => {
    if (Date.now() - lastAppendTime > STALE_MS) {
      callbacks.onLiveness?.('ended');
    }
  }, 1000);

  watcher = watch(filePath, { persistent: false }, async (eventType) => {
    if (eventType !== 'change') return;
    lastAppendTime = Date.now();
    callbacks.onLiveness?.('writing');
    try {
      const newMessages = await readFromLine(lineCount);
      if (newMessages.length > 0) callbacks.onMessages(newMessages);
    } catch {
      // File might be being written; ignore
    }
  });

  // Allow caller to stop watching by not keeping the process alive
  // In TUI we don't need to explicitly close; process exit will clean up.
  // Export a cleanup if needed later:
  // return () => { watcher?.close(); clearInterval(staleTimer); };
}
