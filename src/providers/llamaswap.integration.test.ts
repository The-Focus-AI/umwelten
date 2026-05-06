import { describe, it, expect } from 'vitest';
import { createLlamaSwapProvider } from './llamaswap.js';
import { generateText } from 'ai';
import { ModelRoute } from '../cognition/types.js';
import { checkLlamaSwapConnection } from '../test-utils/setup.js';

const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8080/v1';

const TEST_ROUTE: ModelRoute = {
  name: 'invalid-model',
  provider: 'llamaswap',
};

describe('LlamaSwap Provider', () => {
  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createLlamaSwapProvider();
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('object');
      expect(provider).not.toBeNull();
    });

    it('should accept custom base URL', () => {
      const provider = createLlamaSwapProvider('http://custom:8080/v1');
      expect(provider).toBeDefined();
    });
  });

  describe('Model Listing', () => {
    it('should list available models', async () => {
      const available = await checkLlamaSwapConnection(LLAMASWAP_HOST);
      if (!available) {
        console.warn('⚠️ llama-swap not available, skipping test');
        return;
      }
      const provider = createLlamaSwapProvider(LLAMASWAP_HOST);
      const models = await provider.listModels();
      expect(models).toBeInstanceOf(Array);
      if (models.length > 0) {
        console.log('First llama-swap model:', models[0]);
      }
      models.forEach(model => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBe('llamaswap');
        expect(model.costs).toBeDefined();
      });
    });
  });

  describe('Text Generation', () => {
    it('should generate text with the first available model', async () => {
      const available = await checkLlamaSwapConnection(LLAMASWAP_HOST);
      if (!available) {
        console.warn('⚠️ llama-swap not available, skipping test');
        return;
      }
      const provider = createLlamaSwapProvider(LLAMASWAP_HOST);
      const models = await provider.listModels();
      if (models.length === 0) {
        console.warn('⚠️ No llama-swap models configured, skipping test');
        return;
      }
      const model = provider.getLanguageModel(models[0]);
      const response = await generateText({
        model,
        prompt: 'Say "hello" and nothing else.',
      });
      expect(response.text).toBeTruthy();
      expect(typeof response.text).toBe('string');
    }, 180_000);
  });

  describe('Error Handling', () => {
    it('should error on invalid model IDs', async () => {
      const available = await checkLlamaSwapConnection(LLAMASWAP_HOST);
      if (!available) {
        console.warn('⚠️ llama-swap not available, skipping test');
        return;
      }
      const provider = createLlamaSwapProvider(LLAMASWAP_HOST);
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
