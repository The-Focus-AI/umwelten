import { describe, it, expect } from 'vitest';
import { createLMStudioProvider } from './lmstudio.js';
import { generateText } from 'ai';
import { ModelRoute } from '../models/types.js';

// Default LM Studio host
const LMSTUDIO_HOST = process.env.LMSTUDIO_HOST || 'http://localhost:1234/v1';

// Helper to check if LM Studio is running
const checkLMStudioConnection = async () => {
  try {
    const response = await fetch(`${LMSTUDIO_HOST}/models`);
    return response.ok;
  } catch (e) {
    return false;
  }
};

// Example test route (update with a real model name if needed)
const TEST_ROUTE: ModelRoute = {
  name: 'llama-3.2-1b',
  provider: 'lmstudio',
};

describe('LM Studio Provider', () => {
  describe('Provider Instance', () => {
    it('should create a provider instance', () => {
      const provider = createLMStudioProvider();
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('object');
      expect(provider).not.toBeNull();
    });

    it('should accept custom base URL', () => {
      const provider = createLMStudioProvider('http://custom:1234/v1');
      expect(provider).toBeDefined();
    });
  });

  describe('Model Listing', () => {
    it('should list available models', async () => {
      const lmstudioAvailable = await checkLMStudioConnection();
      if (!lmstudioAvailable) {
        console.warn('⚠️ LM Studio not available, skipping test');
        return;
      }
      const provider = createLMStudioProvider();
      const models = await provider.listModels();
      expect(models).toBeInstanceOf(Array);
      if (models.length > 0) {
        console.log('First model:', models[0]);
      }
      models.forEach(model => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBe('lmstudio');
        expect(model.contextLength).toBeTypeOf('number');
        expect(model.costs).toBeDefined();
      });
    });
  });

  describe('Text Generation', () => {
    it('should generate text with a model', async () => {
      const lmstudioAvailable = await checkLMStudioConnection();
      if (!lmstudioAvailable) {
        console.warn('⚠️ LM Studio not available, skipping test');
        return;
      }
      const provider = createLMStudioProvider();
      const models = await provider.listModels();
      // Find the first loaded model
      const loadedModel = models.find(m => m.details?.state === 'loaded');
      if (!loadedModel) {
        console.warn('⚠️ No loaded models found in LM Studio, skipping test');
        return;
      }
      const model = provider.getLanguageModel(loadedModel);
      const prompt = 'Write a haiku about AI';
      const response = await generateText({
        model,
        prompt,
      });
      console.log('Generated text:', response.text);
      expect(response.text).toBeTruthy();
      expect(typeof response.text).toBe('string');
      expect(response.text.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid model IDs', async () => {
      const provider = createLMStudioProvider();
      const invalidRoute: ModelRoute = {
        ...TEST_ROUTE,
        name: 'invalid-model-name',
      };
      const model = provider.getLanguageModel(invalidRoute);
      const prompt = 'Test prompt';
      let errorCaught = false;
      try {
        await generateText({ model, prompt });
      } catch (e: any) {
        errorCaught = true;
        console.log('Caught error as expected:', e);
        if (e.response) {
          console.log('Error response:', e.response);
        }
        if (e.code) {
          console.log('Error code:', e.code);
        }
        if (e.message) {
          console.log('Error message:', e.message);
        }
      }
      expect(errorCaught).toBe(true);
    });
  });
}); 