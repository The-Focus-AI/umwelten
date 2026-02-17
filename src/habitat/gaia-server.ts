/**
 * Gaia — Habitat Manager web server.
 *
 * Lightweight HTTP server (Node built-in, no deps) that serves the Gaia UI
 * and provides JSON API endpoints for browsing habitats, sessions, and beats.
 *
 * API endpoints:
 *   GET  /api/habitat          — config, agents, tools, skills, stimulus, memory
 *   GET  /api/sessions         — list sessions with metadata
 *   GET  /api/sessions/:id     — session summary (message counts, beats, cost)
 *   GET  /api/sessions/:id/messages  — full conversation messages
 *   GET  /api/sessions/:id/beats     — conversation beats
 *   POST /api/chat             — send a message to the habitat agent (LLM)
 *   GET  /                     — Gaia UI (index.html)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Habitat } from './habitat.js';
import type { HabitatSessionMetadata } from './types.js';
import {
  parseSessionFile,
  summarizeSession,
  getBeatsForSession,
} from '../interaction/persistence/session-parser.js';
import type { AssistantMessageEntry, UserMessageEntry } from '../interaction/types/types.js';
import { Interaction } from '../interaction/core/interaction.js';
import { writeSessionTranscript } from './transcript.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function notFound(res: ServerResponse, message = 'Not found'): void {
  json(res, { error: message }, 404);
}

function serverError(res: ServerResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  json(res, { error: message }, 500);
}

/** Resolve session by full ID or short prefix. */
function findSession(sessions: HabitatSessionMetadata[], idOrPrefix: string): HabitatSessionMetadata | undefined {
  return sessions.find(s => s.sessionId === idOrPrefix || s.sessionId.startsWith(idOrPrefix));
}

/** Get the transcript path for a session. */
async function getTranscriptPath(habitat: Habitat, sessionId: string): Promise<string | null> {
  const dir = await habitat.getSessionDir(sessionId);
  if (!dir) return null;
  return join(dir, 'transcript.jsonl');
}

/** Extract text from message content blocks. */
function msgContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<Record<string, unknown>>)
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text as string)
    .join('\n');
}

/** Extract tool calls from assistant message content. */
function extractToolCallsFromMessage(content: unknown): Array<{
  id: string;
  name: string;
  input: unknown;
}> {
  if (typeof content === 'string' || !Array.isArray(content)) return [];
  return (content as Array<Record<string, unknown>>)
    .filter(b => b.type === 'tool_use')
    .map(b => ({ id: b.id as string, name: b.name as string, input: b.input }));
}

/** Extract tool results from user message content (tool_result blocks). */
function extractToolResults(content: unknown): Array<{
  tool_use_id: string;
  content: string;
  is_error: boolean;
}> {
  if (typeof content === 'string' || !Array.isArray(content)) return [];
  return (content as Array<Record<string, unknown>>)
    .filter(b => b.type === 'tool_result')
    .map(b => ({
      tool_use_id: b.tool_use_id as string,
      content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
      is_error: !!b.is_error,
    }));
}

/** Quick stats from a transcript file without full parsing. */
async function quickTranscriptStats(
  transcriptPath: string,
): Promise<{ messageCount: number; firstPrompt: string }> {
  try {
    const content = await readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    let messageCount = 0;
    let firstPrompt = '';

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' || entry.type === 'assistant') {
          messageCount++;
        }
        if (entry.type === 'user' && !firstPrompt) {
          // Extract first user prompt text
          const c = entry.message?.content;
          if (typeof c === 'string') {
            firstPrompt = c;
          } else if (Array.isArray(c)) {
            const textBlock = c.find((b: Record<string, unknown>) => b.type === 'text');
            if (textBlock?.text) firstPrompt = textBlock.text as string;
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return { messageCount, firstPrompt: firstPrompt.slice(0, 200) };
  } catch {
    return { messageCount: 0, firstPrompt: '' };
  }
}

/** Read the full request body as a parsed JSON object. */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ── Chat state (interaction cache keyed by sessionId) ────────────────────

const chatInteractions = new Map<string, { interaction: Interaction; sessionDir: string; sessionId: string }>();

// ── API Handlers ─────────────────────────────────────────────────────────

async function handleHabitat(habitat: Habitat, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = habitat.getConfig();
  const tools = Object.keys(habitat.getTools());
  const agents = habitat.getAgents();
  const skills = habitat.getSkills().map(s => ({ name: s.name, description: s.description }));
  const stimulus = await habitat.getStimulus();
  const stimulusText = stimulus.getPrompt();

  json(res, {
    name: config.name ?? 'Unnamed Habitat',
    provider: config.defaultProvider,
    model: config.defaultModel,
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      projectPath: a.projectPath,
      gitRemote: a.gitRemote,
      commands: a.commands ? Object.keys(a.commands) : [],
      logPatterns: a.logPatterns,
      statusFile: a.statusFile,
    })),
    tools,
    skills,
    stimulus: stimulusText.slice(0, 2000),
    memoryFiles: config.memoryFiles,
    workDir: habitat.getWorkDir(),
  });
}

async function handleSessionsList(habitat: Habitat, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessions = await habitat.listSessions();
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
  );

  // Enrich with message counts from transcripts (parallel for speed)
  const result = await Promise.all(
    sorted.map(async (s) => {
      const transcriptPath = await getTranscriptPath(habitat, s.sessionId);
      let messageCount = 0;
      let firstPrompt = '';

      if (transcriptPath) {
        const stats = await quickTranscriptStats(transcriptPath);
        messageCount = stats.messageCount;
        firstPrompt = stats.firstPrompt;
      }

      // Fall back to metadata if transcript didn't have data
      if (!firstPrompt && typeof s.metadata?.firstPrompt === 'string') {
        firstPrompt = (s.metadata.firstPrompt as string).slice(0, 200);
      }

      return {
        sessionId: s.sessionId,
        type: s.type,
        created: s.created,
        lastUsed: s.lastUsed,
        firstPrompt,
        messageCount,
        chatId: s.chatId,
      };
    })
  );

  json(res, { sessions: result, total: result.length });
}

async function handleSessionShow(
  habitat: Habitat,
  sessionId: string,
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const sessions = await habitat.listSessions();
  const entry = findSession(sessions, sessionId);
  if (!entry) return notFound(res, `Session "${sessionId}" not found`);

  const transcriptPath = await getTranscriptPath(habitat, entry.sessionId);
  if (!transcriptPath) return notFound(res, `Session directory not found`);

  try {
    const messages = await parseSessionFile(transcriptPath);
    const summary = summarizeSession(messages);
    const { beats } = await getBeatsForSession(messages);

    json(res, {
      sessionId: entry.sessionId,
      type: entry.type,
      created: entry.created,
      lastUsed: entry.lastUsed,
      firstPrompt: summary.firstMessage,
      lastMessage: summary.lastMessage,
      userMessages: summary.userMessages,
      assistantMessages: summary.assistantMessages,
      toolCalls: summary.toolCalls,
      totalTokens: summary.tokenUsage.input_tokens + summary.tokenUsage.output_tokens,
      estimatedCost: summary.estimatedCost,
      duration: summary.duration,
      beatCount: beats.length,
    });
  } catch {
    json(res, {
      sessionId: entry.sessionId,
      type: entry.type,
      created: entry.created,
      lastUsed: entry.lastUsed,
      error: 'Could not parse transcript',
    });
  }
}

async function handleSessionMessages(
  habitat: Habitat,
  sessionId: string,
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const sessions = await habitat.listSessions();
  const entry = findSession(sessions, sessionId);
  if (!entry) return notFound(res, `Session "${sessionId}" not found`);

  const transcriptPath = await getTranscriptPath(habitat, entry.sessionId);
  if (!transcriptPath) return notFound(res, `Session directory not found`);

  try {
    const rawMessages = await parseSessionFile(transcriptPath);

    // Build a rich message list with tool calls inline
    const messages: Array<{
      index: number;
      role: string;
      content: string;
      timestamp?: string;
      toolCalls?: Array<{ id: string; name: string; input: unknown }>;
      toolResults?: Array<{ tool_use_id: string; content: string; is_error: boolean }>;
      model?: string;
    }> = [];

    for (let i = 0; i < rawMessages.length; i++) {
      const msg = rawMessages[i];
      if (msg.type === 'user') {
        const userMsg = msg as UserMessageEntry;
        const text = msgContentToText(userMsg.message.content);
        const toolResults = extractToolResults(userMsg.message.content);

        // Skip tool-result-only messages (they'll be merged with tool calls)
        if (!text.trim() && toolResults.length > 0) {
          // Attach results to the preceding assistant's tool calls
          if (messages.length > 0) {
            const prev = messages[messages.length - 1];
            if (prev.role === 'assistant' && prev.toolCalls) {
              // Merge tool results
              for (const tr of toolResults) {
                const tc = prev.toolCalls.find(t => t.id === tr.tool_use_id);
                if (tc) {
                  (tc as any).output = tr.content.slice(0, 5000);
                  (tc as any).is_error = tr.is_error;
                }
              }
            }
          }
          continue;
        }

        messages.push({
          index: i,
          role: 'user',
          content: text,
          timestamp: userMsg.timestamp,
        });
      } else if (msg.type === 'assistant') {
        const assistantMsg = msg as AssistantMessageEntry;
        const text = msgContentToText(assistantMsg.message.content);
        const toolCalls = extractToolCallsFromMessage(assistantMsg.message.content);

        messages.push({
          index: i,
          role: 'assistant',
          content: text,
          timestamp: assistantMsg.timestamp,
          model: assistantMsg.message.model,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
      }
    }

    json(res, { sessionId: entry.sessionId, messages });
  } catch (err) {
    serverError(res, err);
  }
}

async function handleSessionBeats(
  habitat: Habitat,
  sessionId: string,
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const sessions = await habitat.listSessions();
  const entry = findSession(sessions, sessionId);
  if (!entry) return notFound(res, `Session "${sessionId}" not found`);

  const transcriptPath = await getTranscriptPath(habitat, entry.sessionId);
  if (!transcriptPath) return notFound(res, `Session directory not found`);

  try {
    const rawMessages = await parseSessionFile(transcriptPath);
    const { beats } = await getBeatsForSession(rawMessages);

    json(res, {
      sessionId: entry.sessionId,
      beats: beats.map(b => ({
        index: b.index,
        userPreview: b.userPreview,
        topic: b.topic,
        toolCount: b.toolCount,
        toolDurationMs: b.toolDurationMs,
        assistantPreview: b.assistantPreview,
        messageCount: b.messages.length,
        messageIds: b.messageIds,
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}

/**
 * SSE chat handler — streams events as the LLM runs:
 *   event: session   — { sessionId }
 *   event: text      — { text }  (incremental text delta)
 *   event: tool-call — { name, input }
 *   event: tool-result — { name, output }
 *   event: done      — { content }  (full final text)
 *   event: error     — { error }
 */
async function handleChat(habitat: Habitat, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    return json(res, { error: 'Invalid JSON body' }, 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return json(res, { error: 'Missing "message" field' }, 400);
  }

  const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : undefined;

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let entry = requestedSessionId ? chatInteractions.get(requestedSessionId) : undefined;

    if (!entry) {
      if (agentId) {
        // Route to a sub-agent's interaction
        const habitatAgent = await habitat.getOrCreateHabitatAgent(agentId);
        const interaction = habitatAgent.getInteraction();
        const sessionId = habitatAgent.getSessionId();
        const sessionDir = await habitat.getSessionDir(sessionId) ?? '';
        entry = { interaction, sessionDir, sessionId };
      } else {
        const result = await habitat.createInteraction({
          sessionType: 'web',
        });
        entry = { interaction: result.interaction, sessionDir: result.sessionDir, sessionId: result.sessionId };
      }
      chatInteractions.set(entry.sessionId, entry);
    }

    const { interaction, sessionDir, sessionId } = entry;
    sendEvent('session', { sessionId, agentId: agentId ?? null });

    // Hook into transcript updates to detect tool calls/results as they happen
    const msgCountBefore = interaction.getMessages().length;
    const originalCallback = interaction.onTranscriptUpdate;
    interaction.setOnTranscriptUpdate((messages) => {
      // Check for new messages added by the runner
      for (let i = msgCountBefore + 1; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const part of msg.content as unknown as Array<Record<string, unknown>>) {
            if (part.type === 'tool-call') {
              sendEvent('tool-call', { name: part.toolName, input: part.input ?? part.args });
            }
          }
        }
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
          for (const part of msg.content as unknown as Array<Record<string, unknown>>) {
            if (part.type === 'tool-result') {
              const output = part.output as Record<string, unknown> | undefined;
              const outputStr = output?.value != null
                ? String(output.value).slice(0, 500)
                : typeof part.content === 'string' ? (part.content as string).slice(0, 500) : '';
              sendEvent('tool-result', { name: part.toolName, output: outputStr, isError: output?.type === 'error-text' });
            }
          }
        }
      }
      // Also write transcript to disk
      void writeSessionTranscript(sessionDir, messages);
    });

    // Add the user message
    interaction.addMessage({ role: 'user', content: message });

    // Intercept stdout to capture text deltas for SSE
    const origWrite = process.stdout.write.bind(process.stdout);
    let capturing = true;
    process.stdout.write = function (chunk: any, ...args: any[]) {
      if (capturing && typeof chunk === 'string' && chunk.length > 0) {
        sendEvent('text', { text: chunk });
      }
      return origWrite(chunk, ...args);
    } as any;

    // Run the model
    let response;
    try {
      response = await interaction.streamText();
    } finally {
      capturing = false;
      process.stdout.write = origWrite;
      // Restore original transcript callback
      interaction.onTranscriptUpdate = originalCallback ?? undefined;
    }

    // Persist final transcript
    await writeSessionTranscript(sessionDir, interaction.getMessages());

    sendEvent('done', { content: response.content, sessionId });
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendEvent('error', { error: message });
    res.end();
  }
}

// ── Router ───────────────────────────────────────────────────────────────

function parseRoute(url: string): { path: string; query: Record<string, string> } {
  const [path, qs] = url.split('?', 2);
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=', 2);
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { path: path ?? '/', query };
}

// ── Server ───────────────────────────────────────────────────────────────

export interface GaiaServerOptions {
  habitat: Habitat;
  port?: number;
  host?: string;
}

export async function startGaiaServer(options: GaiaServerOptions): Promise<{ port: number; close: () => void }> {
  const { habitat, port = 3000, host = '0.0.0.0' } = options;

  // Resolve path to the UI HTML file
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const projectRoot = resolve(thisDir, '..', '..');
  const uiPath = join(projectRoot, 'examples', 'gaia-ui', 'index.html');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { path } = parseRoute(req.url ?? '/');

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // API routes
      if (path === '/api/chat' && req.method === 'POST') {
        return await handleChat(habitat, req, res);
      }
      if (path === '/api/habitat') {
        return await handleHabitat(habitat, req, res);
      }
      if (path === '/api/sessions') {
        return await handleSessionsList(habitat, req, res);
      }

      // /api/sessions/:id/messages
      const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
      if (messagesMatch) {
        return await handleSessionMessages(habitat, messagesMatch[1], req, res);
      }

      // /api/sessions/:id/beats
      const beatsMatch = path.match(/^\/api\/sessions\/([^/]+)\/beats$/);
      if (beatsMatch) {
        return await handleSessionBeats(habitat, beatsMatch[1], req, res);
      }

      // /api/sessions/:id
      const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        return await handleSessionShow(habitat, sessionMatch[1], req, res);
      }

      // Serve UI
      if (path === '/' || path === '/index.html') {
        try {
          const html = await readFile(uiPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Gaia UI not found at ${uiPath}. Run from the umwelten project root.`);
        }
        return;
      }

      notFound(res);
    } catch (err) {
      serverError(res, err);
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectPromise(new Error(`Port ${port} is already in use. Try --port ${port + 1}`));
      } else {
        rejectPromise(err);
      }
    });
    server.listen(port, host, () => {
      const actualPort = (server.address() as { port: number }).port;
      resolvePromise({
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}
