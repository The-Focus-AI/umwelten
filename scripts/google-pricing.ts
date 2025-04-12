import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import fs from 'fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
const pricingPage = 'https://ai.google.dev/gemini-api/docs/pricing';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlFile = path.resolve(__dirname, '../output/google-pricing/html.txt');
const modelResponseFile = path.resolve(__dirname, '../output/google-pricing/model-response.txt');
const pricingFile = path.resolve(__dirname, '../output/google-pricing/pricing.json');

const pricingSchema = z.object({
  'pricing': z.array(z.object({
    'model': z.string().describe('The model name'),
    'inputCost': z.number().describe('The cost of 1 million input tokens'),
    'outputCost': z.number().describe('The cost of 1 million output tokens'),
    'description': z.string().describe('A description of the model'),
    'contextLength': z.number().describe('The context length of the model'),  
    'caching': z.boolean().describe('Whether the model supports caching'),
  })),
});

async function getGooglePricingFile() {
  if(fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    return html;
  }
  console.log('Fetching Google pricing...');

  const response = await fetch(pricingPage);
  const html = await response.text();
  
  const dir = path.dirname(htmlFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(htmlFile, html);
  return html;
}

async function getModelResponse() {
  if(fs.existsSync(modelResponseFile)) {
    const modelResponse = fs.readFileSync(modelResponseFile, 'utf8');
    return modelResponse;
  }

  const html = await getGooglePricingFile();

  // const model:ModelDetails = {
  //   name: 'gemma3:12b',
  //   provider: 'ollama',
  // };

  const model:ModelDetails = {
    // name: 'gemma-3-27b-it',
    name:'google/gemma-3-12b-it',
    provider: 'openrouter',
  };

  const prompt = `You are a a software agent that looks at html to find model pricing and you return json`

  const conversation = new Conversation(model, prompt);

  conversation.addMessage({
    role: 'user',
    content: html,
  });

  conversation.addMessage({
    role: 'user',
    content: `Please parse the html and return the json in the form specified by the schema ${JSON.stringify(zodToJsonSchema(pricingSchema))}`
  });

  const modelRunner = new BaseModelRunner();
  const response = await modelRunner.stream(conversation);

  fs.writeFileSync(modelResponseFile, response.content);
  return response.content;
}

async function googlePricing() {
  const modelResponse = await getModelResponse();
  const pricing = parseJsonFromModelResponse(modelResponse);
  return pricing;
}

function parseJsonFromModelResponse(modelResponse: string) {
  if(modelResponse.includes('```json')) {
    modelResponse = modelResponse.split('```json').pop()!.split('```')[0];
    // modelResponse = modelResponse.split('```json')[1].split('```')[0];
  }
  const pricing = JSON.parse(modelResponse);
  return pricing;
}

googlePricing().then((pricing) => {
  console.log(pricing);
  process.exit(0);
}).catch((error) => {
  console.error('Error fetching Google pricing:', error);
});
