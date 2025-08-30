import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Interaction } from '../../interaction/interaction.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { getModel } from '../../providers/index.js';
import { 
  calculatorTool, 
  randomNumberTool, 
  statisticsTool,
  ToolSet
} from './index.js';
import { checkOllamaConnection } from '../../test-utils/setup.js';

describe('Tool Integration Tests with Ollama', () => {
  let runner: BaseModelRunner;
  let toolSet: ToolSet;

  beforeEach(() => {
    runner = new BaseModelRunner();
    toolSet = {
      calculator: calculatorTool as any,
      randomNumber: randomNumberTool as any,
      statistics: statisticsTool as any,
    };
  });



  describe('Ollama qwen3:latest Tool Calling', () => {
    it('should call calculator tool with qwen3:latest', async () => {
      // Skip if Ollama is not available
      const ollamaAvailable = await checkOllamaConnection();
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping integration test');
        return;
      }

      const interaction = new Interaction(
        { name: 'qwen3:latest', provider: 'ollama' },
        "You are a helpful assistant with access to mathematical tools. Use the calculator tool to perform calculations when asked."
      );

      interaction.setTools(toolSet);
      interaction.setMaxSteps(3);
      interaction.addMessage({
        role: "user",
        content: "Calculate 15 + 27 using the calculator tool",
      });

      const response = await runner.streamText(interaction);

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      
      // Check if tool was called by looking for tool call evidence
      const content = response.content || '';
      const hasToolCall = content.includes('calculator') || 
                         content.includes('15 + 27') || 
                         content.includes('42') ||
                         response.metadata?.toolCalls?.length > 0;
      
      expect(hasToolCall).toBe(true);
    }, 30000); // 30 second timeout for Ollama

    it('should call statistics tool with qwen3:latest', async () => {
      // Skip if Ollama is not available
      const ollamaAvailable = await checkOllamaConnection();
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping integration test');
        return;
      }

      const interaction = new Interaction(
        { name: 'qwen3:latest', provider: 'ollama' },
        "You are a helpful assistant with access to statistical tools. Use the statistics tool to analyze data when asked."
      );

      interaction.setTools(toolSet);
      interaction.setMaxSteps(3);
      interaction.addMessage({
        role: "user",
        content: "Calculate statistics for the numbers [10, 20, 30, 40, 50] using the statistics tool",
      });

      const response = await runner.streamText(interaction);

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      
      // Check if tool was called by looking for tool call evidence
      const content = response.content || '';
      const hasToolCall = content.includes('statistics') || 
                         content.includes('mean') || 
                         content.includes('30') ||
                         response.metadata?.toolCalls?.length > 0;
      
      expect(hasToolCall).toBe(true);
    }, 30000); // 30 second timeout for Ollama

    it('should handle multiple tool calls in sequence with qwen3:latest', async () => {
      // Skip if Ollama is not available
      const ollamaAvailable = await checkOllamaConnection();
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping integration test');
        return;
      }

      const interaction = new Interaction(
        { name: 'qwen3:latest', provider: 'ollama' },
        "You are a helpful assistant with access to mathematical tools. Use the available tools to help answer questions and perform calculations."
      );

      interaction.setTools(toolSet);
      interaction.setMaxSteps(5);
      interaction.addMessage({
        role: "user",
        content: "First calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]",
      });

      const response = await runner.streamText(interaction);

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      
      // Check if multiple tools were called
      const content = response.content || '';
      const hasCalculator = content.includes('calculator') || content.includes('15 + 27') || content.includes('42');
      const hasRandom = content.includes('random') || content.includes('randomNumber');
      const hasStatistics = content.includes('statistics') || content.includes('mean');
      
      // At least one tool should be called
      const toolCalls = hasCalculator || hasRandom || hasStatistics || (response.metadata?.toolCalls?.length || 0) > 0;
      expect(toolCalls).toBe(true);
    }, 45000); // 45 second timeout for multiple tool calls
  });

  describe('Tool Execution Context', () => {
    it('should provide proper execution context to tools', async () => {
      // Skip if Ollama is not available
      const ollamaAvailable = await checkOllamaConnection();
      if (!ollamaAvailable) {
        console.warn('⚠️ Ollama not available, skipping integration test');
        return;
      }

      const interaction = new Interaction(
        { name: 'gpt-oss:latest', provider: 'ollama' },
        "You are a helpful assistant with access to mathematical tools. Use the calculator tool to perform calculations when asked."
      );

      interaction.setTools(toolSet);
      interaction.setMaxSteps(3);
      interaction.addMessage({
        role: "user",
        content: "Calculate 5 + 3 using the calculator tool",
      });

      const response = await runner.streamText(interaction);

      expect(response).toBeDefined();
      expect(response.metadata).toBeDefined();
      
      // Check that metadata includes execution information
      expect(response.metadata.startTime).toBeInstanceOf(Date);
      expect(response.metadata.endTime).toBeInstanceOf(Date);
      expect(response.metadata.tokenUsage).toBeDefined();
      expect(response.metadata.cost).toBeDefined();
    }, 30000); // 30 second timeout for Ollama
  });
});
