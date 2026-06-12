import { describe, it, expect } from 'vitest';
import { resolveProxyTarget } from './routes.js';

describe('resolveProxyTarget', () => {
  it('maps the contexts metadata route through to the container', () => {
    expect(resolveProxyTarget('/api/habitats/h1/contexts/ctx-abc')).toEqual({
      id: 'h1',
      targetPath: '/api/contexts/ctx-abc',
    });
  });

  it('maps the contexts transcript route through to the container', () => {
    expect(
      resolveProxyTarget('/api/habitats/h1/contexts/ctx-abc/transcript'),
    ).toEqual({
      id: 'h1',
      targetPath: '/api/contexts/ctx-abc/transcript',
    });
  });

  it('keeps the existing static mappings', () => {
    expect(resolveProxyTarget('/api/habitats/h2/artifacts')).toEqual({
      id: 'h2',
      targetPath: '/api/artifacts',
    });
    expect(resolveProxyTarget('/api/habitats/h2/agent-card')).toEqual({
      id: 'h2',
      targetPath: '/.well-known/agent-card.json',
    });
  });

  it('keeps the files wildcard mapping', () => {
    expect(resolveProxyTarget('/api/habitats/h3/files/a/b.txt')).toEqual({
      id: 'h3',
      targetPath: '/files/a/b.txt',
    });
  });

  it('forwards an empty wildcard remainder as-is (parity with /files/*)', () => {
    expect(resolveProxyTarget('/api/habitats/h1/contexts')).toEqual({
      id: 'h1',
      targetPath: '/api/contexts/',
    });
  });

  it('returns null for non-proxied paths', () => {
    expect(resolveProxyTarget('/api/habitats/h1/logs')).toBeNull();
    expect(resolveProxyTarget('/api/secrets')).toBeNull();
  });
});

describe('resolveProxyTarget — per-session routes (#120)', () => {
  it('maps the sessions list route', () => {
    expect(resolveProxyTarget('/api/habitats/h1/sessions')).toEqual({
      id: 'h1',
      targetPath: '/api/sessions',
    });
  });

  it('maps per-session subpaths (messages) through the wildcard', () => {
    expect(resolveProxyTarget('/api/habitats/h1/sessions/s-42/messages')).toEqual({
      id: 'h1',
      targetPath: '/api/sessions/s-42/messages',
    });
  });
});
