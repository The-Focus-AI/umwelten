/**
 * Replay a pulled beat through the current Jeeves agent.
 * Usage: jeeves sessions replay <pulled.json> [--provider P] [--model M]
 */

import { readFile } from 'node:fs/promises';
import type { CoreMessage } from 'ai';
import type { NormalizedMessage } from '../../src/interaction/types/normalized-types.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { createJeevesHabitat } from './habitat.js';

const DEFAULT_PROVIDER = process.env.JEEVES_PROVIDER || 'google';
const DEFAULT_MODEL = process.env.JEEVES_MODEL || 'gemini-2.0-flash';

export interface PulledPayload {
  sessionId: string;
  beatIndex: number;
  messages: NormalizedMessage[];
  userPreview?: string;
  assistantPreview?: string;
  toolCount?: number;
}

/**
 * Convert NormalizedMessage[] to CoreMessage[] for replay.
 * When dropLastAssistant is true, the last message is removed if it's assistant (so the model regenerates it).
 * Groups assistant + following tool messages into assistant (tool-call blocks) + tool (tool-result) messages.
 */
function normalizedToCoreMessages(
  normalized: NormalizedMessage[],
  dropLastAssistant: boolean
): CoreMessage[] {
  const out: CoreMessage[] = [];
  const toDrop =
    dropLastAssistant &&
    normalized.length > 0 &&
    normalized[normalized.length - 1].role === 'assistant';
  const list = toDrop ? normalized.slice(0, -1) : normalized;
  let i = 0;

  while (i < list.length) {
    const msg = list[i];
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content || '' });
      i++;
    } else if (msg.role === 'assistant') {
      const textContent = (msg.content || '').trim();
      let j = i + 1;
      while (j < list.length && list[j].role === 'tool') j++;
      const toolMessages = j > i + 1 ? list.slice(i + 1, j) : [];
      if (toolMessages.length > 0) {
        const blocks: Array<
          | { type: 'text'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
        > = [];
        if (textContent) blocks.push({ type: 'text', text: textContent });
        for (const tm of toolMessages) {
          blocks.push({
            type: 'tool-call',
            toolCallId: tm.id,
            toolName: tm.tool?.name ?? 'unknown',
            args: (tm.tool?.input as Record<string, unknown>) ?? {},
          });
        }
        out.push({ role: 'assistant', content: blocks });
        for (const tm of toolMessages) {
          const raw = tm.tool?.output;
          const output =
            tm.tool?.isError === true
              ? { type: 'error-text' as const, value: typeof raw === 'string' ? raw : JSON.stringify(raw ?? '') }
              : typeof raw === 'string'
                ? { type: 'text' as const, value: raw }
                : { type: 'json' as const, value: raw };
          out.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: tm.id,
                toolName: tm.tool?.name ?? 'unknown',
                output,
              },
            ],
          } as CoreMessage);
        }
        i = j;
      } else {
        out.push({ role: 'assistant', content: textContent || '' });
        i++;
      }
    } else if (msg.role === 'tool') {
      const raw = msg.tool?.output;
      const output =
        msg.tool?.isError === true
          ? { type: 'error-text' as const, value: typeof raw === 'string' ? raw : JSON.stringify(raw ?? '') }
          : typeof raw === 'string'
            ? { type: 'text' as const, value: raw }
            : { type: 'json' as const, value: raw };
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: msg.id,
            toolName: msg.tool?.name ?? 'unknown',
            output,
          },
        ],
      } as CoreMessage);
      i++;
    } else {
      i++;
    }
  }
  return out;
}

export async function runReplay(
  inputPath: string,
  options: { provider?: string; model?: string } = {}
): Promise<string> {
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const model = options.model ?? DEFAULT_MODEL;
  const raw =
    inputPath === '-' || inputPath === '/dev/stdin'
      ? await readStdin()
      : await readFile(inputPath, 'utf-8');
  const payload = JSON.parse(raw) as PulledPayload;
  if (!payload.messages || !Array.isArray(payload.messages)) {
    throw new Error('Invalid pulled JSON: expected "messages" array');
  }

  const habitat = await createJeevesHabitat();
  const stimulus = await habitat.getStimulus();
  const interaction = new Interaction({ provider, name: model }, stimulus);
  const coreMessages = normalizedToCoreMessages(payload.messages, true);
  for (const msg of coreMessages) {
    interaction.addMessage(msg);
  }
  const response = await interaction.generateText();
  const text =
    typeof response.content === 'string'
      ? response.content
      : response.content != null
        ? String(response.content)
        : '';
  return text;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}
