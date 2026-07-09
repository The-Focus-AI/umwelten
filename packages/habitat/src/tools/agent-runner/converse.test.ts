import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Participant, TurnResult } from '@umwelten/core/dialogue/index.js';
import { createAgentConverseTool } from './converse.js';
import type { AgentRunnerToolsContext } from './context.js';
import {
  withAgentCall,
  withFreshAgentCallContext,
} from '../../identity/agent-call-context.js';
import type { AgentEntry } from '../../types.js';

function scriptedParticipant(
  id: string,
  displayName: string,
  reply: (turn: number) => TurnResult,
): Participant {
  let turns = 0;
  return {
    id,
    displayName,
    kind: 'model' as const,
    async takeTurn() {
      turns++;
      return reply(turns);
    },
  };
}

describe('agent_converse', () => {
  let tempDir: string;
  let workDir: string;
  let agents: AgentEntry[];
  let ctx: AgentRunnerToolsContext;
  let replies: Map<string, (turn: number) => TurnResult>;

  function makeTool() {
    return createAgentConverseTool(ctx, {
      buildParticipant: (agent) =>
        scriptedParticipant(
          agent.id,
          agent.name || agent.id,
          replies.get(agent.id) ?? ((turn) => ({ content: `${agent.id} says ${turn}` })),
        ),
    });
  }

  async function execute(input: Record<string, unknown>) {
    const tool = makeTool() as any;
    return tool.execute(input, { messages: [], toolCallId: 'test' });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-converse-test-'));
    workDir = join(tempDir, 'work');
    agents = [
      { id: 'alpha', name: 'Alpha', projectPath: join(tempDir, 'a') },
      { id: 'beta', name: 'Beta', projectPath: join(tempDir, 'b') },
      { id: 'gamma', name: 'Gamma', projectPath: join(tempDir, 'c') },
    ];
    replies = new Map();
    ctx = {
      getWorkDir: () => workDir,
      getAgent: (id) => agents.find((a) => a.id === id || a.name === id),
      getAgents: () => agents,
      addAgent: async () => {},
      updateAgent: async () => {},
      getOrCreateHabitatAgent: async () => ({}) as any,
      getAgentDir: (id: string) => join(workDir, 'agents', id),
      ensureAgentDir: async () => {},
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects unknown agents and lists available ones', async () => {
    const result = await execute({ agentIds: ['alpha', 'nope'], topic: 't' });
    expect(result.error).toBe('AGENT_NOT_FOUND');
    expect(result.message).toContain('nope');
    expect(result.message).toContain('alpha, beta, gamma');
  });

  it('rejects duplicate participants (also via name aliasing)', async () => {
    const result = await execute({ agentIds: ['alpha', 'Alpha'], topic: 't' });
    expect(result.error).toBe('DUPLICATE_PARTICIPANTS');
  });

  it('rejects a dialogue that includes the calling agent (cycle)', async () => {
    const result = await withAgentCall('alpha', () =>
      execute({ agentIds: ['alpha', 'beta'], topic: 't' }),
    );
    expect(result.error).toBe('AGENT_CALL_CYCLE');
    expect(result.chain).toEqual(['alpha']);
  });

  it('rejects when the call chain is at max depth', async () => {
    const result = await withAgentCall('x', () =>
      withAgentCall('y', () =>
        withAgentCall('z', () => execute({ agentIds: ['alpha', 'beta'], topic: 't' })),
      ),
    );
    expect(result.error).toBe('AGENT_CALL_DEPTH_EXCEEDED');
  });

  it('runs round-robin turns and persists the session under workDir', async () => {
    const result = await withFreshAgentCallContext(() =>
      execute({ agentIds: ['alpha', 'beta'], topic: 'discuss caching', maxTurns: 4 }),
    );
    expect(result.error).toBeUndefined();
    expect(result.turnCount).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.participants).toEqual(['alpha', 'beta']);
    expect(result.transcript.map((t: { speaker: string }) => t.speaker)).toEqual([
      'Alpha',
      'Beta',
      'Alpha',
      'Beta',
    ]);
    expect(result.transcript[0].text).toBe('alpha says 1');

    const transcript = await readFile(
      join(workDir, 'sessions', result.sessionId, 'transcript.jsonl'),
      'utf-8',
    );
    expect(transcript).toContain('[Alpha]: alpha says 1');
    const meta = JSON.parse(
      await readFile(join(workDir, 'sessions', result.sessionId, 'meta.json'), 'utf-8'),
    );
    expect(meta.type).toBe('dialogue');
  });

  it('uses ctx.getOrCreateSession when available', async () => {
    const sessionDir = join(tempDir, 'custom-sessions', 'dialogue-x');
    ctx.getOrCreateSession = async () => ({ sessionId: 'dialogue-x', sessionDir });
    const result = await execute({ agentIds: ['alpha', 'beta'], topic: 't', maxTurns: 2 });
    expect(result.sessionId).toBe('dialogue-x');
    const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.sessionId).toBe('dialogue-x');
  });

  it('returns a partial transcript plus error when a participant fails mid-dialogue', async () => {
    replies.set('beta', () => {
      throw new Error('model exploded');
    });
    const result = await execute({ agentIds: ['alpha', 'beta'], topic: 't', maxTurns: 4 });
    expect(result.error).toBe('AGENT_CONVERSE_FAILED');
    expect(result.message).toContain('model exploded');
    expect(result.sessionId).toBeDefined();
    expect(result.transcript).toHaveLength(1);
    expect(result.transcript[0].speaker).toBe('Alpha');
  });

  it('truncates long turns and caps the returned transcript', async () => {
    replies.set('alpha', (turn) => ({ content: 'x'.repeat(2000) + ` end ${turn}` }));
    const result = await execute({ agentIds: ['alpha', 'beta'], topic: 't', maxTurns: 16 });
    expect(result.truncated).toBe(true);
    expect(result.transcript.length).toBeLessThanOrEqual(12);
    expect(result.transcript[0].text.length).toBeLessThanOrEqual(1501);
    expect(result.turnCount).toBe(16);
  });
});
