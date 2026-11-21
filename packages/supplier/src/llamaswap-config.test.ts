import { describe, it, expect } from 'vitest';
import {
  normalizeModelName,
  buildLlamaSwapConfig,
  dedupeByAlias,
  type GgufModel,
} from './llamaswap-config.js';

describe('normalizeModelName', () => {
  const cases: Array<[string, string]> = [
    ['gemma-4-26B-A4B-it-UD-Q4_K_M.gguf', 'gemma-4-26b-a4b'],
    ['gemma-4-26B-A4B-it-Q8_0.gguf', 'gemma-4-26b-a4b'],
    ['NVIDIA-Nemotron-3-Nano-4B-Q8_0.gguf', 'nvidia-nemotron-3-nano-4b'],
    ['GLM-4.7-Flash-Q8_0.gguf', 'glm-4-7-flash'],
    ['gpt-oss-20b-mxfp4.gguf', 'gpt-oss-20b'],
    ['unsloth/gemma-4-26B-A4B-it-GGUF', 'gemma-4-26b-a4b'],
    // leading publisher stripped
    ['ggml-org/GLM-4.7-Flash-GGUF', 'glm-4-7-flash'],
    // already normalized returns unchanged
    ['gemma-4-26b-a4b', 'gemma-4-26b-a4b'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(normalizeModelName(input)).toBe(expected);
    });
  }
});

describe('dedupeByAlias', () => {
  it('keeps the largest file when aliases collide', () => {
    const input: GgufModel[] = [
      { path: '/a/gemma-Q4_K_M.gguf', baseName: 'gemma-Q4_K_M', alias: 'gemma', sizeBytes: 17_000_000_000 },
      { path: '/b/gemma-Q8_0.gguf', baseName: 'gemma-Q8_0', alias: 'gemma', sizeBytes: 27_000_000_000 },
      { path: '/c/gemma-BF16.gguf', baseName: 'gemma-BF16', alias: 'gemma', sizeBytes: 50_000_000_000 },
    ];
    const out = dedupeByAlias(input);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('/c/gemma-BF16.gguf');
  });

  it('sorts output by alias', () => {
    const input: GgufModel[] = [
      { path: '/z.gguf', baseName: 'z', alias: 'zebra', sizeBytes: 1 },
      { path: '/a.gguf', baseName: 'a', alias: 'alpha', sizeBytes: 1 },
      { path: '/m.gguf', baseName: 'm', alias: 'mango', sizeBytes: 1 },
    ];
    const out = dedupeByAlias(input);
    expect(out.map(m => m.alias)).toEqual(['alpha', 'mango', 'zebra']);
  });
});

describe('buildLlamaSwapConfig', () => {
  const fixture: GgufModel[] = [
    { path: '/Users/w/.cache/huggingface/hub/models--unsloth--gemma-4-26B-A4B-it-GGUF/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf', baseName: 'x', alias: 'gemma-4-26b-a4b', sizeBytes: 17_000_000_000 },
    { path: '/Users/w/.cache/huggingface/hub/models--ggml-org--GLM-4.7-Flash-GGUF/GLM-4.7-Flash-Q8_0.gguf', baseName: 'y', alias: 'glm-4-7-flash', sizeBytes: 10_000_000_000 },
  ];

  it('produces a models: block with one entry per alias', () => {
    const yaml = buildLlamaSwapConfig(fixture);
    expect(yaml).toContain('models:');
    expect(yaml).toContain('"gemma-4-26b-a4b":');
    expect(yaml).toContain('"glm-4-7-flash":');
  });

  it('templates the port placeholder', () => {
    const yaml = buildLlamaSwapConfig(fixture);
    expect(yaml).toContain('--port ${PORT}');
  });

  it('quotes paths with spaces', () => {
    const models: GgufModel[] = [
      { path: '/Users/w/with space/model.gguf', baseName: 'model', alias: 'm', sizeBytes: 1 },
    ];
    const yaml = buildLlamaSwapConfig(models);
    expect(yaml).toMatch(/-m "\/Users\/w\/with space\/model\.gguf"/);
  });

  it('honors ctxSize and ttlSeconds options', () => {
    const yaml = buildLlamaSwapConfig(fixture, { ctxSize: 32768, ttlSeconds: 60 });
    expect(yaml).toContain('--ctx-size 32768');
    expect(yaml).toContain('ttl: 60');
  });

  it('uses a custom llama-server binary path when given', () => {
    const yaml = buildLlamaSwapConfig(fixture, { llamaServerPath: '/opt/homebrew/bin/llama-server' });
    expect(yaml).toContain('/opt/homebrew/bin/llama-server');
  });

  it('appends extraArgs', () => {
    const yaml = buildLlamaSwapConfig(fixture, { extraArgs: ['--flash-attn', '-ngl', '99'] });
    expect(yaml).toMatch(/--flash-attn -ngl 99/);
  });

  it('can omit the header comment block', () => {
    const yaml = buildLlamaSwapConfig(fixture, { includeHeader: false });
    expect(yaml.startsWith('models:')).toBe(true);
  });

  it('dedupes aliases in the output', () => {
    const dup: GgufModel[] = [
      { path: '/a/foo-Q4.gguf', baseName: 'foo-Q4', alias: 'foo', sizeBytes: 1_000 },
      { path: '/b/foo-Q8.gguf', baseName: 'foo-Q8', alias: 'foo', sizeBytes: 2_000 },
    ];
    const yaml = buildLlamaSwapConfig(dup);
    const fooMatches = yaml.match(/"foo":/g) ?? [];
    expect(fooMatches).toHaveLength(1);
    expect(yaml).toContain('/b/foo-Q8.gguf');
  });
});
