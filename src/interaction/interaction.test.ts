import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Interaction } from './interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import { tool } from 'ai';
import { z } from 'zod';

// Mock calculator tool for testing using Vercel AI SDK pattern
const calculatorTool = tool({
  description: "Perform arithmetic calculations",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
    a: z.number().describe("The first number"),
    b: z.number().describe("The second number"),
  }),
  execute: async ({ operation, a, b }) => {
    let result: number;
    switch (operation) {
      case "add": result = a + b; break;
      case "subtract": result = a - b; break;
      case "multiply": result = a * b; break;
      case "divide": 
        if (b === 0) throw new Error("Division by zero");
        result = a / b; 
        break;
      default: throw new Error(`Unsupported operation: ${operation}`);
    }
    return { operation, operands: [a, b], result };
  },
});

describe('New Interaction Constructor', () => {
  const mockModel = { 
    name: "test-model", 
    provider: "test" as const,
    costs: { promptTokens: 0.001, completionTokens: 0.002 }
  };

  it('should require modelDetails and stimulus', () => {
    const stimulus = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.modelDetails).toEqual(mockModel);
    expect(interaction.getStimulus()).toEqual(stimulus);
  });

  it('should apply stimulus context automatically', () => {
    const stimulus = new Stimulus({
      role: "math tutor",
      objective: "help with calculations",
      tools: { calculator: calculatorTool },
      temperature: 0.7,
      runnerType: 'memory'
    });
    
    const interaction = new Interaction(mockModel, stimulus);
    
    // Check system prompt includes stimulus context
    const messages = interaction.getMessages();
    expect(messages[0].content).toContain("math tutor");
    expect(messages[0].content).toContain("help with calculations");
    expect(messages[0].content).toContain("Available Tools");
    
    // Check tools are applied
    expect(interaction.getVercelTools()).toEqual({ calculator: calculatorTool });
    
    // Check model options are applied
    expect(interaction.options?.temperature).toBe(0.7);
    
    // Check runner type is applied
    expect(interaction.getRunner().constructor.name).toContain('Memory');
  });

  it('should update stimulus dynamically', () => {
    const stimulus1 = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(mockModel, stimulus1);
    
    const stimulus2 = new Stimulus({ 
      role: "math tutor", 
      tools: { calculator: calculatorTool } 
    });
    interaction.setStimulus(stimulus2);
    
    expect(interaction.getStimulus()).toEqual(stimulus2);
    expect(interaction.getVercelTools()).toEqual({ calculator: calculatorTool });
  });

  it('should handle stimulus without tools', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      objective: "be helpful",
      temperature: 0.5
    });
    
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.hasTools()).toBe(false);
    expect(interaction.getVercelTools()).toBeUndefined();
    expect(interaction.options?.temperature).toBe(0.5);
  });

  it('should handle stimulus with model options', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      temperature: 0.8,
      maxTokens: 150,
      topP: 0.9
    });
    
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.options?.temperature).toBe(0.8);
    expect(interaction.options?.maxTokens).toBe(150);
    expect(interaction.options?.topP).toBe(0.9);
  });

  it('should handle stimulus with tool instructions and limits', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      tools: { calculator: calculatorTool },
      toolInstructions: ["Use calculator for arithmetic"],
      maxToolSteps: 3
    });
    
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.getVercelTools()).toEqual({ calculator: calculatorTool });
    expect(interaction.maxSteps).toBe(3);
    
    // Check that tool instructions are in the system prompt
    const messages = interaction.getMessages();
    expect(messages[0].content).toContain("Tool Usage Instructions");
    expect(messages[0].content).toContain("Use calculator for arithmetic");
    expect(messages[0].content).toContain("Maximum tool steps: 3");
  });

  it('should handle stimulus with system context', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      systemContext: "You are working in a secure environment."
    });
    
    const interaction = new Interaction(mockModel, stimulus);
    
    const messages = interaction.getMessages();
    expect(messages[0].content).toContain("Additional Context");
    expect(messages[0].content).toContain("secure environment");
  });

  it('should create base runner by default', () => {
    const stimulus = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.getRunner().constructor.name).toBe('BaseModelRunner');
  });

  it('should create memory runner when specified', () => {
    const stimulus = new Stimulus({ 
      role: "assistant",
      runnerType: 'memory'
    });
    const interaction = new Interaction(mockModel, stimulus);
    
    expect(interaction.getRunner().constructor.name).toContain('Memory');
  });

  it('should maintain backward compatibility with existing methods', () => {
    const stimulus = new Stimulus({ role: "assistant" });
    const interaction = new Interaction(mockModel, stimulus);
    
    // Test that existing methods still work
    interaction.addMessage({
      role: "user",
      content: "Hello"
    });
    
    expect(interaction.getMessages()).toHaveLength(2);
    expect(interaction.getMessages()[1].content).toBe("Hello");
    
    // Test tool management methods
    interaction.addTool('testTool', calculatorTool);
    expect(interaction.hasTools()).toBe(true);
    expect(interaction.getVercelTools()).toHaveProperty('testTool');
    
    // Test max steps
    interaction.setMaxSteps(5);
    expect(interaction.maxSteps).toBe(5);
  });
});
