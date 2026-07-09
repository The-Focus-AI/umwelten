import { describe, it, expect } from 'vitest';
import {
  parsePersonaSpec,
  parseAgentSpec,
  parseModelRef,
  speakerColor,
} from './converse.js';

describe('parsePersonaSpec', () => {
  it('parses "Name=prompt"', () => {
    expect(parsePersonaSpec('Advocate=You argue for the topic.')).toEqual({
      name: 'Advocate',
      prompt: 'You argue for the topic.',
    });
  });

  it('parses "Name:provider/model=prompt"', () => {
    expect(
      parsePersonaSpec('Skeptic:openrouter/openai/gpt-5=You argue against.'),
    ).toEqual({
      name: 'Skeptic',
      provider: 'openrouter',
      model: 'openai/gpt-5',
      prompt: 'You argue against.',
    });
  });

  it('keeps "=" inside the prompt intact', () => {
    expect(parsePersonaSpec('Mathy=Assume x=1 and argue.')).toEqual({
      name: 'Mathy',
      prompt: 'Assume x=1 and argue.',
    });
  });

  it('rejects specs without a prompt or name', () => {
    expect(() => parsePersonaSpec('NoPrompt')).toThrow(/Invalid persona spec/);
    expect(() => parsePersonaSpec('NoPrompt=')).toThrow(/Invalid persona spec/);
    expect(() => parsePersonaSpec('=prompt only')).toThrow(/Invalid persona spec/);
  });

  it('rejects a model reference without provider/model shape', () => {
    expect(() => parsePersonaSpec('Skeptic:gpt-5=prompt')).toThrow(
      /provider\/model/,
    );
  });
});

describe('parseAgentSpec', () => {
  it('parses a bare agent id', () => {
    expect(parseAgentSpec('backend')).toEqual({ id: 'backend' });
    expect(parseAgentSpec('  backend ')).toEqual({ id: 'backend' });
  });

  it('parses "id:provider/model" as a per-agent model override', () => {
    expect(parseAgentSpec('backend:openrouter/google/gemini-3.5-flash')).toEqual({
      id: 'backend',
      modelDetails: { provider: 'openrouter', name: 'google/gemini-3.5-flash' },
    });
  });

  it('rejects a spec with a colon but no valid model reference', () => {
    expect(() => parseAgentSpec('backend:gemini')).toThrow(/provider\/model/);
    expect(() => parseAgentSpec(':openrouter/gpt-5')).toThrow(/Invalid agent spec/);
  });
});

describe('parseModelRef', () => {
  it('splits provider/model on the first slash', () => {
    expect(parseModelRef('google/gemini-3-flash-preview')).toEqual({
      provider: 'google',
      name: 'gemini-3-flash-preview',
    });
    expect(parseModelRef('openrouter/anthropic/claude-sonnet-5')).toEqual({
      provider: 'openrouter',
      name: 'anthropic/claude-sonnet-5',
    });
  });

  it('rejects malformed references', () => {
    expect(() => parseModelRef('gemini')).toThrow(/provider\/model/);
    expect(() => parseModelRef('google/')).toThrow(/provider\/model/);
  });
});

describe('speakerColor', () => {
  it('assigns stable colors by join order and wraps around', () => {
    const c0 = speakerColor(0);
    const c4 = speakerColor(4);
    // same palette slot → same function behavior on input
    expect(c0('x')).toBe(c4('x'));
    expect(typeof c0('hello')).toBe('string');
  });
});
