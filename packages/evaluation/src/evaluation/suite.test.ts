import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fauxAssistantMessage, fauxProvider, fauxThinking } from '@earendil-works/pi-ai';
import { registerPiProvider } from '@umwelten/pi';
import { EvalSuite, isJudgeTask, type VerifyTask, type JudgeTask, type EvalTask } from './suite.js';
import { z } from 'zod';

describe('isJudgeTask', () => {
  const verifyTask: VerifyTask = {
    id: 'v1',
    name: 'Verify Task',
    prompt: 'What is 2+2?',
    maxScore: 1,
    verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
  };

  const judgeTask: JudgeTask = {
    id: 'j1',
    name: 'Judge Task',
    prompt: 'Write a poem',
    maxScore: 10,
    judge: {
      schema: z.object({
        score: z.number().describe('Score from 0-10'),
        explanation: z.string().describe('Why this score'),
      }),
      instructions: ['Rate the creativity of this poem.'],
    },
  };

  it('returns false for a VerifyTask', () => {
    expect(isJudgeTask(verifyTask)).toBe(false);
  });

  it('returns true for a JudgeTask', () => {
    expect(isJudgeTask(judgeTask)).toBe(true);
  });

  it('correctly narrows type for VerifyTask', () => {
    const task: EvalTask = verifyTask;
    if (!isJudgeTask(task)) {
      // TypeScript should narrow to VerifyTask here
      const result = task.verify('4');
      expect(result.score).toBe(1);
      expect(result.details).toBe('4');
    }
  });

  it('correctly narrows type for JudgeTask', () => {
    const task: EvalTask = judgeTask;
    if (isJudgeTask(task)) {
      expect(task.judge.instructions).toContain('Rate the creativity of this poem.');
    }
  });
});

describe('VerifyTask scoring', () => {
  it('returns correct score for matching response', () => {
    const task: VerifyTask = {
      id: 'math',
      prompt: 'What is 2+2?',
      maxScore: 1,
      verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
    };
    const result = task.verify('4');
    expect(result.score).toBe(1);
    expect(result.details).toBe('4');
  });

  it('returns zero score for non-matching response', () => {
    const task: VerifyTask = {
      id: 'math',
      prompt: 'What is 2+2?',
      maxScore: 1,
      verify: (r) => ({ score: r.trim() === '4' ? 1 : 0, details: r.trim() }),
    };
    const result = task.verify('5');
    expect(result.score).toBe(0);
    expect(result.details).toBe('5');
  });

  it('handles partial scoring', () => {
    const task: VerifyTask = {
      id: 'partial',
      prompt: 'List primary colors',
      maxScore: 3,
      verify: (r) => {
        const colors = ['red', 'blue', 'yellow'];
        const lower = r.toLowerCase();
        const found = colors.filter(c => lower.includes(c));
        return { score: found.length, details: `Found: ${found.join(', ')}` };
      },
    };

    expect(task.verify('Red and blue').score).toBe(2);
    expect(task.verify('red, blue, yellow').score).toBe(3);
    expect(task.verify('green and purple').score).toBe(0);
  });

  it('handles whitespace in responses', () => {
    const task: VerifyTask = {
      id: 'trim',
      prompt: 'Say hello',
      maxScore: 1,
      verify: (r) => ({ score: r.trim() === 'hello' ? 1 : 0, details: r.trim() }),
    };
    expect(task.verify('  hello  ').score).toBe(1);
    expect(task.verify('\nhello\n').score).toBe(1);
  });
});

describe('JudgeTask extractScore', () => {
  it('uses custom extractScore when provided', () => {
    const task: JudgeTask = {
      id: 'custom-extract',
      prompt: 'Write something',
      maxScore: 10,
      judge: {
        schema: z.object({ quality: z.number(), creativity: z.number() }),
        instructions: ['Rate quality and creativity'],
        extractScore: (r) => (r.quality + r.creativity) / 2,
      },
    };
    const mockJudgeResult = { quality: 8, creativity: 6 };
    const score = task.judge.extractScore!(mockJudgeResult);
    expect(score).toBe(7);
  });

  it('default extractScore pattern works with reasoning_quality', () => {
    // This tests the default fallback used in EvalSuite.run()
    const defaultExtract = (r: any) => r.reasoning_quality ?? r.score ?? 0;
    expect(defaultExtract({ reasoning_quality: 8, score: 5 })).toBe(8);
    expect(defaultExtract({ score: 5 })).toBe(5);
    expect(defaultExtract({})).toBe(0);
  });
});

describe('EvalTask type guards', () => {
  it('tasks with both verify and judge are treated as judge tasks', () => {
    // Edge case: a task object that has both properties
    const ambiguous = {
      id: 'both',
      prompt: 'test',
      maxScore: 1,
      verify: (r: string) => ({ score: 1, details: r }),
      judge: {
        schema: z.object({ score: z.number() }),
        instructions: ['rate it'],
      },
    } as EvalTask;
    // isJudgeTask checks for 'judge' property, so it returns true
    expect(isJudgeTask(ambiguous)).toBe(true);
  });

  it('task without judge or verify is not a judge task', () => {
    const minimal = { id: 'x', prompt: 'y', maxScore: 1 } as EvalTask;
    expect(isJudgeTask(minimal)).toBe(false);
  });
});

describe('EvalSuite execution, caching, judge cost, and executionOrder', () => {
  const prevEvalDir = process.env.UMWELTEN_EVAL_DIR;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (prevEvalDir === undefined) delete process.env.UMWELTEN_EVAL_DIR;
    else process.env.UMWELTEN_EVAL_DIR = prevEvalDir;
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('tracks full tokenUsage, separates judgeCostUsd, measures error duration, and reuses Layer 2 cache when judge changes', async () => {
    const evalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelten-suite-test-'));
    tempDirs.push(evalDir);
    process.env.UMWELTEN_EVAL_DIR = evalDir;

    let candidateCalls = 0;
    let judgeCalls = 0;

    const candProvider = fauxProvider({
      provider: 'faux-suite-cand',
      models: [
        { id: 'm-ok', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
        { id: 'm-err', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, reasoning: true },
      ],
    });
    const candStep = (_ctx: unknown, _opts: unknown, _state: unknown, reqModel: { id: string }) => {
      candProvider.appendResponses([candStep]);
      if (reqModel.id === 'm-err') {
        throw new Error('simulated upstream error');
      }
      candidateCalls++;
      return fauxAssistantMessage([
        fauxThinking('Reasoning through the answer.'),
        { type: 'text', text: 'Drive to the car wash.' },
      ]);
    };
    candProvider.setResponses([candStep]);
    registerPiProvider(candProvider.provider);

    const judgeProvider = fauxProvider({
      provider: 'faux-suite-judge',
      models: [{ id: 'judge-1', cost: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 } }],
    });
    const judgeStep = () => {
      judgeProvider.appendResponses([judgeStep]);
      judgeCalls++;
      return fauxAssistantMessage(
        JSON.stringify({ reasoning_quality: 5, explanation: 'Correctly drives car.' }),
      );
    };
    judgeProvider.setResponses([judgeStep]);
    registerPiProvider(judgeProvider.provider);

    const suite1 = new EvalSuite({
      name: 'unit-judge-cache-suite',
      judgeModel: { provider: 'faux-suite-judge', name: 'judge-1' },
      judgeDelayMs: 0,
      models: [
        { provider: 'faux-suite-cand', name: 'm-ok', reasoningEffort: 'high' },
        { provider: 'faux-suite-cand', name: 'm-err' },
      ],
      tasks: [
        {
          id: 'cw',
          prompt: 'Should I drive?',
          maxScore: 5,
          judge: {
            schema: z.object({ reasoning_quality: z.number(), explanation: z.string() }),
            instructions: ['Rubric v1'],
          },
        },
      ],
    });

    const res1 = await suite1.run();
    const okRec = res1.find((r) => r.model === 'm-ok')!;
    const errRec = res1.find((r) => r.model === 'm-err')!;

    expect(okRec.score).toBe(5);
    expect(okRec.effectiveThinkingLevel).toBe('high');
    expect(okRec.tokenUsage?.reasoningTokens).toBeGreaterThan(0);
    expect(okRec.tokenUsage?.cacheReadTokens).toBe(0);
    expect(okRec.judgeCostUsd).toBeGreaterThan(0);
    expect(suite1.getLastRunStats().judgeCostUsd).toBeGreaterThan(0);
    expect(errRec.error).toContain('simulated upstream error');
    expect(errRec.durationMs).toBeGreaterThan(0);
    expect(candidateCalls).toBe(1);
    expect(judgeCalls).toBe(1);

    // Changing only judge instructions invalidates Layer 1 record but hits Layer 2 response cache
    const suite2 = new EvalSuite({
      name: 'unit-judge-cache-suite',
      judgeModel: { provider: 'faux-suite-judge', name: 'judge-1' },
      judgeDelayMs: 0,
      models: [{ provider: 'faux-suite-cand', name: 'm-ok', reasoningEffort: 'high' }],
      tasks: [
        {
          id: 'cw',
          prompt: 'Should I drive?',
          maxScore: 5,
          judge: {
            schema: z.object({ reasoning_quality: z.number(), explanation: z.string() }),
            instructions: ['Rubric v2'],
          },
        },
      ],
    });

    await suite2.run();
    expect(candidateCalls).toBe(1); // Layer 2 response cache hit!
    expect(judgeCalls).toBe(2); // Re-judged under Rubric v2
  });

  it('supports executionOrder: model-first across tasks', async () => {
    const evalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelten-suite-order-'));
    tempDirs.push(evalDir);
    process.env.UMWELTEN_EVAL_DIR = evalDir;

    const callOrder: string[] = [];
    const orderProvider = fauxProvider({
      provider: 'faux-order',
      models: [{ id: 'm1' }, { id: 'm2' }],
    });
    const step = (ctx: { messages: Array<{ content: unknown }> }, _o: unknown, _s: unknown, reqModel: { id: string }) => {
      orderProvider.appendResponses([step]);
      const p = String(ctx.messages[0]?.content ?? '');
      callOrder.push(`${reqModel.id}:${p}`);
      return fauxAssistantMessage('4');
    };
    orderProvider.setResponses([step]);
    registerPiProvider(orderProvider.provider);

    const suite = new EvalSuite({
      name: 'unit-model-first',
      executionOrder: 'model-first',
      concurrency: 1,
      models: [
        { provider: 'faux-order', name: 'm1' },
        { provider: 'faux-order', name: 'm2' },
      ],
      tasks: [
        { id: 't1', prompt: 't1', maxScore: 1, verify: () => ({ score: 1, details: 'ok' }) },
        { id: 't2', prompt: 't2', maxScore: 1, verify: () => ({ score: 1, details: 'ok' }) },
      ],
    });

    const out = await suite.run();
    expect(out).toHaveLength(4);
    expect(callOrder).toEqual(['m1:t1', 'm1:t2', 'm2:t1', 'm2:t2']);
  });
});
