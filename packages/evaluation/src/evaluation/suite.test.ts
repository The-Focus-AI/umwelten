import { describe, it, expect } from 'vitest';
import { isJudgeTask, type VerifyTask, type JudgeTask, type EvalTask } from './suite.js';
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
