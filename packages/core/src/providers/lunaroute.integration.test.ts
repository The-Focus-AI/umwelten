import { describe, it, expect } from 'vitest';
import { createLunaRouteProvider } from './lunaroute.js';
import { generateText, streamText } from 'ai';

const API_KEY = process.env.LUNAROUTE_API_KEY;

describe('LunaRoute Provider', () => {
  describe('Provider Instance', () => {
    it('should create a provider instance with a key', () => {
      const provider = createLunaRouteProvider('test-key');
      expect(provider).toBeDefined();
    });

    it('should throw without an API key', () => {
      expect(() => createLunaRouteProvider(undefined as unknown as string)).toThrow();
    });
  });

  describe('Model Listing', () => {
    it('should list available models', async () => {
      if (!API_KEY) {
        console.warn('⚠️ LUNAROUTE_API_KEY not set, skipping test');
        return;
      }
      const provider = createLunaRouteProvider(API_KEY);
      const models = await provider.listModels();
      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);
      console.log('LunaRoute models:', models.map((m) => m.name));
      models.forEach((model) => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBe('lunaroute');
        expect(model.costs).toBeDefined();
      });
    });

    it('should include a glm-5.2 variant with pricing', async () => {
      if (!API_KEY) {
        console.warn('⚠️ LUNAROUTE_API_KEY not set, skipping test');
        return;
      }
      const provider = createLunaRouteProvider(API_KEY);
      const models = await provider.listModels();
      // Gateway serves variant IDs, e.g. "glm-5.2-nvfp4"
      const glm = models.find((m) => m.name.startsWith('glm-5.2'));
      expect(glm).toBeDefined();
      expect(glm!.costs.promptTokens).toBeGreaterThan(0);
      expect(glm!.costs.completionTokens).toBeGreaterThan(0);
    });
  });

  describe('Text Generation (glm-5.2)', () => {
    async function glmModelName(): Promise<string> {
      const provider = createLunaRouteProvider(API_KEY!);
      const models = await provider.listModels();
      const glm = models.find((m) => m.name.startsWith('glm-5.2'));
      expect(glm).toBeDefined();
      return glm!.name;
    }

    it('should generate text', async () => {
      if (!API_KEY) {
        console.warn('⚠️ LUNAROUTE_API_KEY not set, skipping test');
        return;
      }
      const provider = createLunaRouteProvider(API_KEY);
      const model = provider.getLanguageModel({ name: await glmModelName(), provider: 'lunaroute' });
      const response = await generateText({
        model,
        prompt: 'Say "hello" and nothing else.',
      });
      expect(response.text).toBeTruthy();
      expect(typeof response.text).toBe('string');
      console.log('glm-5.2 says:', response.text);
    }, 180_000);

    it('should stream text and report usage', async () => {
      if (!API_KEY) {
        console.warn('⚠️ LUNAROUTE_API_KEY not set, skipping test');
        return;
      }
      const provider = createLunaRouteProvider(API_KEY);
      const model = provider.getLanguageModel({ name: await glmModelName(), provider: 'lunaroute' });
      const result = streamText({
        model,
        prompt: 'Count from 1 to 5, digits only.',
      });
      let streamed = '';
      for await (const chunk of result.textStream) {
        streamed += chunk;
      }
      expect(streamed).toBeTruthy();
      const usage = await result.usage;
      expect(usage.totalTokens).toBeGreaterThan(0);
    }, 180_000);
  });
});
