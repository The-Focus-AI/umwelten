import { describe, it, expect } from 'vitest';
import { createLlamaBarnProvider } from './llamabarn.js';
import { generateText } from 'ai';
import { ModelRoute } from '../cognition/types.js';
import { checkLlamaBarnConnection } from '../test-utils/setup.js';

const LLAMABARN_HOST = process.env.LLAMABARN_HOST || 'http://localhost:2276/v1';

const TEST_ROUTE: ModelRoute = {
  name: 'invalid-model',
  provider: 'llamabarn',
};

describe('LlamaBarn Provider', () => {
  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createLlamaBarnProvider();
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('object');
      expect(provider).not.toBeNull();
    });

    it('should accept custom base URL', () => {
      const provider = createLlamaBarnProvider('http://custom:2276/v1');
      expect(provider).toBeDefined();
    });
  });

  describe('Model Listing', () => {
    it('should list available models', async () => {
      const available = await checkLlamaBarnConnection(LLAMABARN_HOST);
      if (!available) {
        console.warn('⚠️ LlamaBarn not available, skipping test');
        return;
      }
      const provider = createLlamaBarnProvider(LLAMABARN_HOST);
      const models = await provider.listModels();
      expect(models).toBeInstanceOf(Array);
      if (models.length > 0) {
        console.log('First LlamaBarn model:', models[0]);
      }
      models.forEach(model => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBe('llamabarn');
        expect(model.costs).toBeDefined();
      });
    });
  });

  describe('Text Generation', () => {
    it('should generate text with a loaded or sleeping model', async () => {
      const available = await checkLlamaBarnConnection(LLAMABARN_HOST);
      if (!available) {
        console.warn('⚠️ LlamaBarn not available, skipping test');
        return;
      }
      const provider = createLlamaBarnProvider(LLAMABARN_HOST);
      const models = await provider.listModels();
      // Prefer an already-loaded or sleeping model (sleeping wakes on demand)
      const ready = models.find(m => m.details?.state === 'loaded')
        ?? models.find(m => m.details?.state === 'sleeping')
        ?? models[0];
      if (!ready) {
        console.warn('⚠️ No LlamaBarn models available, skipping test');
        return;
      }
      const model = provider.getLanguageModel(ready);
      const response = await generateText({
        model,
        prompt: 'Say "hello" and nothing else.',
      });
      expect(response.text).toBeTruthy();
      expect(typeof response.text).toBe('string');
    }, 120_000);
  });

  describe('Error Handling', () => {
    it('should error on invalid model IDs', async () => {
      const available = await checkLlamaBarnConnection(LLAMABARN_HOST);
      if (!available) {
        console.warn('⚠️ LlamaBarn not available, skipping test');
        return;
      }
      const provider = createLlamaBarnProvider(LLAMABARN_HOST);
      const model = provider.getLanguageModel(TEST_ROUTE);
      let errorCaught = false;
      try {
        await generateText({ model, prompt: 'Test' });
      } catch {
        errorCaught = true;
      }
      expect(errorCaught).toBe(true);
    });
  });
});
