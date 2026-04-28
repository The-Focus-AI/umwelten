/**
 * REGRESSION GUARDS — do not weaken.
 *
 * These tests enforce the project's "no silent output-token caps" rule:
 * the runner powers benchmarks that measure model quality, and any cap on
 * generated tokens silently invalidates scores (especially for thinking-on
 * models that need room to reason before emitting their final answer).
 *
 * If a specific caller genuinely needs a cap for a one-off task, it must
 * set it on the Stimulus. Never add a default cap in runner/config/wiring.
 *
 * See CLAUDE.md "Token limits" rule for the full context. If you are here
 * adding a cap because you think "the tests never finish without one,"
 * STOP — the task is slow for a reason, and a cap will hide it.
 */
import { describe, it, expect } from 'vitest';
import { buildRequestOptions } from './request-options.js';
import { Stimulus } from '../stimulus/stimulus.js';
import { Interaction } from '../interaction/core/interaction.js';
import type { ModelDetails } from './types.js';

function makeInteractionWithMessage(stimulus: Stimulus): Interaction {
  const details: ModelDetails = { name: 'fake', provider: 'openrouter' };
  const i = new Interaction(details, stimulus);
  // minimal user message so options builder doesn't choke on empty history
  (i as any).messages.push({ role: 'user', content: 'hi' });
  return i;
}

describe('buildRequestOptions — token-cap regression guards', () => {
  it('does NOT inject maxOutputTokens when no caller/stimulus set one', () => {
    const stim = new Stimulus({ role: 'test' });
    const interaction = makeInteractionWithMessage(stim);

    const opts = buildRequestOptions({
      interaction,
      model: {} as any,
      config: {},
      label: 'test',
      streaming: false,
    });

    expect('maxOutputTokens' in opts).toBe(false);
    expect('maxTokens' in opts).toBe(false);
  });

  it('does NOT inject a cap even when passed an (ignored) config hint', () => {
    // Guards against a future refactor that re-adds a config.maxTokens
    // fallback and silently re-injects it into the request.
    const stim = new Stimulus({ role: 'test' });
    const interaction = makeInteractionWithMessage(stim);

    const opts = buildRequestOptions({
      interaction,
      model: {} as any,
      // deliberately include junk properties — builder must not treat
      // any of these as a generation cap.
      config: { maxTokens: 4096, maxOutputTokens: 4096, max_tokens: 4096 } as any,
      label: 'test',
      streaming: false,
    });

    expect('maxOutputTokens' in opts).toBe(false);
    expect(opts.maxOutputTokens).toBeUndefined();
  });

  it('honors a Stimulus-set maxTokens (the only sanctioned way to cap)', () => {
    // If a stimulus author intentionally sets a cap, it should reach the
    // request. We don't transform it — AI SDK v5 accepts either key from
    // caller input via the spread of interaction.options.
    const stim = new Stimulus({ role: 'test', maxTokens: 2000 });
    const interaction = makeInteractionWithMessage(stim);

    const opts = buildRequestOptions({
      interaction,
      model: {} as any,
      config: {},
      label: 'test',
      streaming: false,
    });

    // Whatever the key, SOMETHING token-related should be present since
    // the author asked for it explicitly.
    const hasExplicitCap =
      (opts as any).maxOutputTokens !== undefined ||
      (opts as any).maxTokens !== undefined;
    expect(hasExplicitCap).toBe(true);
  });
});
