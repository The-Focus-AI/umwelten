import { describe, it, expect } from 'vitest';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { calculatorTool, statisticsTool } from './index.js';
import {
  checkOllamaConnection,
  OLLAMA_INTEGRATION_MODEL,
} from '../../test-utils/setup.js';

describe(`Tool Integration - ${OLLAMA_INTEGRATION_MODEL} (Ollama)`, () => {
  it(`should call calculator tool with ${OLLAMA_INTEGRATION_MODEL}`, async () => {
    const available = await checkOllamaConnection();
    if (!available) {
      console.warn('⚠️ Ollama not available, skipping Ollama tool integration test');
      return;
    }

    const stimulus = new Stimulus({
      role: "helpful assistant with access to tools",
      tools: { calculator: calculatorTool },
      maxToolSteps: 3
    });
    
    const interaction = new Interaction(
      { name: OLLAMA_INTEGRATION_MODEL, provider: 'ollama' },
      stimulus
    );
    interaction.addMessage({ role: 'user', content: 'Use the calculator tool to compute 12 + 30' });

    const runner = new BaseModelRunner();
    const response = await runner.streamText(interaction);

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  }, 30000);

  it(`should handle multiple tools with ${OLLAMA_INTEGRATION_MODEL}`, async () => {
    const available = await checkOllamaConnection();
    if (!available) {
      console.warn('⚠️ Ollama not available, skipping Ollama multi-tool test');
      return;
    }

    const stimulus = new Stimulus({
      role: "helpful assistant with access to tools",
      tools: { calculator: calculatorTool, statistics: statisticsTool },
      maxToolSteps: 5
    });
    
    const interaction = new Interaction(
      { name: OLLAMA_INTEGRATION_MODEL, provider: 'ollama' },
      stimulus
    );
    interaction.addMessage({ role: 'user', content: 'Compute 10 + 5, then statistics for [1,2,3,4,5]' });

    const runner = new BaseModelRunner();
    const response = await runner.streamText(interaction);

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  }, 45000);
});

