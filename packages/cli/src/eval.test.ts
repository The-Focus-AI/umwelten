import { describe, expect, it } from 'vitest';
import { parseEvaluationModels } from './eval.js';

describe('parseEvaluationModels', () => {
  it('parses provider:model references and preserves model slashes', () => {
    expect(
      parseEvaluationModels('ollama:qwen3:30b-a3b, openrouter:openai/gpt-5.4'),
    ).toEqual([
      { provider: 'ollama', name: 'qwen3:30b-a3b' },
      { provider: 'openrouter', name: 'openai/gpt-5.4' },
    ]);
  });

  it('rejects malformed model references', () => {
    expect(() => parseEvaluationModels('gpt-5.4')).toThrow('provider:model');
    expect(() => parseEvaluationModels('ollama:')).toThrow('provider:model');
  });
});
