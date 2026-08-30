import { describe, expect, it } from 'vitest';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';
import { runFullEval } from './index.js';

const model: ModelDetails = {
  provider: 'ollama',
  name: 'test-model',
};

describe('runFullEval', () => {
  it('supports selecting no suites without contacting a provider', async () => {
    const result = await runFullEval(model, { only: [] });

    expect(result.model).toBe(model);
    expect(result.suites).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stops before constructing a selected suite when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by harness'));

    await expect(
      runFullEval(model, { only: ['language'], signal: controller.signal }),
    ).rejects.toThrow('cancelled by harness');
  });
});
