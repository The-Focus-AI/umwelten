import { describe, it, expect } from 'vitest';
import { Interaction } from '../../interaction/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { calculatorTool, statisticsTool } from './index.js';
import { checkOllamaConnection } from '../../test-utils/setup.js';

describe('Tool Integration - gpt-oss:latest (Ollama)', () => {
  it('should call calculator tool with gpt-oss:latest', async () => {
    const available = await checkOllamaConnection();
    if (!available) {
      console.warn('⚠️ Ollama not available, skipping gpt-oss integration test');
      return;
    }

    const stimulus = new Stimulus({
      role: "helpful assistant with access to tools",
      tools: { calculator: calculatorTool },
      maxToolSteps: 3
    });
    
    const interaction = new Interaction(
      { name: 'gpt-oss:latest', provider: 'ollama' },
      stimulus
    );
    interaction.addMessage({ role: 'user', content: 'Use the calculator tool to compute 12 + 30' });

    const runner = new BaseModelRunner();
    const response = await runner.streamText(interaction);

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  }, 30000);

  it('should handle multiple tools with gpt-oss:latest', async () => {
    const available = await checkOllamaConnection();
    if (!available) {
      console.warn('⚠️ Ollama not available, skipping gpt-oss multi-tool test');
      return;
    }

    const stimulus = new Stimulus({
      role: "helpful assistant with access to tools",
      tools: { calculator: calculatorTool, statistics: statisticsTool },
      maxToolSteps: 5
    });
    
    const interaction = new Interaction(
      { name: 'gpt-oss:latest', provider: 'ollama' },
      stimulus
    );
    interaction.addMessage({ role: 'user', content: 'Compute 10 + 5, then statistics for [1,2,3,4,5]' });

    const runner = new BaseModelRunner();
    const response = await runner.streamText(interaction);

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  }, 45000);
});

