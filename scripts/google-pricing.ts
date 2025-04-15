import { EvaluationRunner } from '../src/evaluation/runner.js';
import { z } from 'zod';
import { Conversation } from '../src/conversation/conversation.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { BaseModelRunner } from '../src/models/runner.js';

const pricingPage = 'https://ai.google.dev/gemini-api/docs/pricing';

const pricingSchema = z.object({
  'pricing': z.array(z.object({
    'model': z.string().describe('The model name'),
    'modelId': z.string().describe('The model id'),
    'inputCost': z.number().describe('The cost of 1 million input tokens'),
    'outputCost': z.number().describe('The cost of 1 million output tokens'),
    'description': z.string().describe('A description of the model'),
    'contextLength': z.number().describe('The context length of the model'),  
    'caching': z.boolean().describe('Whether the model supports caching'),
  })),
});


async function parseGooglePricing(html: string, model:ModelDetails): Promise<ModelResponse> {
  const prompt = `You are a pricing agent that looks through the pricing page and returns the pricing for the models described on the page`

  const conversation = new Conversation(model , prompt);

  conversation.addMessage({
    role: 'user',
    content: html,
  });

  const modelRunner = new BaseModelRunner();
  const response = await modelRunner.streamObject(conversation, pricingSchema);

  return response;
}

class GooglePricing extends EvaluationRunner {
  constructor() {
    super('google-pricing');
  }

  async getHtml() {
    return this.getCachedFile( "html", async () => {
      const html = await fetch(pricingPage, {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      return html.text();
    });
  }

  async getModelResponse(details: ModelDetails) : Promise<ModelResponse> {
    const html = await this.getHtml();

    return parseGooglePricing(html, details);
  }
}

const runner = new GooglePricing( );

await runner.evaluate({
  name: 'gemini-2.0-flash',
  provider: 'google',
});

await runner.evaluate({
  name: 'gemini-2.5-pro-exp-03-25',
  provider: 'google',
});

await runner.evaluate({
  name: 'gemini-1.5-flash-8b',
  provider: 'google',
});


// await runner.evaluate({
//   name: 'qwen2.5:14b',
//   provider: 'ollama',
// });

await runner.evaluate({
  name: 'openai/gpt-4o-mini',
  provider: 'openrouter',
});

await runner.evaluate({
  name: 'mistralai/mistral-nemo',
  provider: 'openrouter',
});

// await runner.evaluate({
//   name: 'gemma3:12b',
//   provider: 'ollama',
// });
