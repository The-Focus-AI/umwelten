#!/usr/bin/env node
/**
 * Test script to debug Telegram streamText issue
 */

import { createJeevesHabitat } from './habitat.js';
import { Interaction } from '../../src/interaction/core/interaction.js';

const DEFAULT_PROVIDER = process.env.JEEVES_PROVIDER || 'ollama';
const DEFAULT_MODEL = process.env.JEEVES_MODEL || 'gpt-oss:latest';

async function testStreamText() {
  console.log('Testing streamText with tool calls...\n');

  const habitat = await createJeevesHabitat();
  const stimulus = await habitat.getStimulus();
  const interaction = new Interaction(
    { name: DEFAULT_MODEL, provider: DEFAULT_PROVIDER },
    stimulus
  );

  interaction.addMessage({ role: "user", content: "What is the latest Turing post?" });
  
  console.log('Calling streamText...\n');
  const response = await interaction.streamText();
  
  console.log('\n=== RESPONSE ===');
  console.log('Content:', response.content);
  console.log('Content length:', (response.content as string)?.length || 0);
  console.log('Content type:', typeof response.content);
  
  const metadata = response.metadata as any;
  console.log('\n=== METADATA ===');
  console.log('Keys:', Object.keys(metadata || {}));
  if (metadata?.toolCalls) {
    const toolCalls = await (Array.isArray(metadata.toolCalls) 
      ? Promise.resolve(metadata.toolCalls)
      : metadata.toolCalls);
    console.log('Tool calls:', toolCalls.length);
  }
  if (metadata?.toolResults) {
    const toolResults = await (Array.isArray(metadata.toolResults) 
      ? Promise.resolve(metadata.toolResults)
      : metadata.toolResults);
    console.log('Tool results:', toolResults.length);
  }
  
  console.log('\n=== MESSAGES ===');
  const messages = interaction.getMessages();
  console.log('Total messages:', messages.length);
  messages.slice(-5).forEach((msg, i) => {
    console.log(`Message ${messages.length - 5 + i}:`, {
      role: msg.role,
      contentType: typeof msg.content,
      contentLength: typeof msg.content === 'string' ? msg.content.length : Array.isArray(msg.content) ? msg.content.length : 'N/A',
      contentPreview: typeof msg.content === 'string' ? msg.content.substring(0, 100) : 'N/A'
    });
  });
}

testStreamText().catch((err) => {
  console.error(err);
  process.exit(1);
});
