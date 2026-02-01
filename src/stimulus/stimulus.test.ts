import { describe, it, expect } from 'vitest'
import { Stimulus } from "./stimulus";
import { tool } from "ai";
import { z } from "zod";

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

describe('Stimulus maker', () => {
    it('should create a basic stimulus', async () => {
        const stimulus = new Stimulus();

        expect(stimulus.getPrompt()).toEqual("You are a helpful assistant.")
    })

    it('should create a stimulus with a role', async () => {
        const stimulus = new Stimulus({role: "literary critic"});

        expect(stimulus.getPrompt()).toEqual("You are a literary critic.")
    })

    it('should create a stimulus with a role and objective', async () => {
        const stimulus = new Stimulus({role: "literary critic", objective: "analyze the book"});

        expect(stimulus.getPrompt()).toEqual("You are a literary critic.\nYour objective is to analyze the book.")
    })

    it('should create a stimulus instructions', async () => {
        const stimulus = new Stimulus();
        stimulus.addInstruction("You should always respond in the style of a pirate.");
        stimulus.addInstruction("You should repeat the question before answering it.");

        expect(stimulus.getPrompt()).toEqual(`You are a helpful assistant.

# Instructions
- You should always respond in the style of a pirate.
- You should repeat the question before answering it.
`)
        })
    
        it('should create a stimulus output format', async () => {
            const stimulus = new Stimulus();
            stimulus.addOutput("You should always response in xml");
            stimulus.addOutput("You should use random case for the response");
    
            expect(stimulus.getPrompt()).toEqual(`You are a helpful assistant.

# Output Format
- You should always response in xml
- You should use random case for the response
`)
            })
});

describe('Enhanced Stimulus', () => {
  it('should include tools in environmental context', () => {
    const stimulus = new Stimulus({
      role: "math tutor",
      tools: { calculator: calculatorTool }
    });
    expect(stimulus.hasTools()).toBe(true);
    expect(stimulus.getTools()).toEqual({ calculator: calculatorTool });
  });

  it('should include model options', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      temperature: 0.7,
      maxTokens: 200
    });
    expect(stimulus.getModelOptions()).toEqual({
      temperature: 0.7,
      maxTokens: 200,
      topP: undefined,
      frequencyPenalty: undefined,
      presencePenalty: undefined
    });
  });

  it('should specify runner type', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      runnerType: 'memory'
    });
    expect(stimulus.getRunnerType()).toBe('memory');
  });

  it('should generate enhanced prompt with tool context', () => {
    const stimulus = new Stimulus({
      role: "math tutor",
      objective: "help with calculations",
      tools: { calculator: calculatorTool },
      toolInstructions: ["Use calculator for arithmetic"]
    });
    const prompt = stimulus.getPrompt();
    expect(prompt).toContain("Available Tools");
    expect(prompt).toContain("calculator");
    expect(prompt).toContain("Tool Usage Instructions");
  });

  it('should handle multiple tools', () => {
    const webSearchTool = tool({
      description: "Search the web for information",
      inputSchema: z.object({
        query: z.string().describe("The search query")
      }),
      execute: async ({ query }) => {
        return { query, results: [] };
      },
    });
    
    const stimulus = new Stimulus({
      role: "research assistant",
      tools: { 
        calculator: calculatorTool,
        webSearch: webSearchTool
      }
    });
    
    expect(stimulus.hasTools()).toBe(true);
    expect(Object.keys(stimulus.getTools())).toHaveLength(2);
    expect(stimulus.getTools()).toHaveProperty('calculator');
    expect(stimulus.getTools()).toHaveProperty('webSearch');
  });

  it('should add tools dynamically', () => {
    const stimulus = new Stimulus({ role: "assistant" });
    expect(stimulus.hasTools()).toBe(false);
    
    stimulus.addTool('calculator', calculatorTool);
    expect(stimulus.hasTools()).toBe(true);
    expect(stimulus.getTools()).toEqual({ calculator: calculatorTool });
  });

  it('should set tools in bulk', () => {
    const stimulus = new Stimulus({ role: "assistant" });
    const webSearchTool = tool({
      description: "Search the web",
      inputSchema: z.object({
        query: z.string().describe("The search query")
      }),
      execute: async ({ query }) => ({ query, results: [] }),
    });
    const tools = { 
      calculator: calculatorTool,
      webSearch: webSearchTool
    };
    
    stimulus.setTools(tools);
    expect(stimulus.getTools()).toEqual(tools);
  });

  it('should check for model options presence', () => {
    const stimulus1 = new Stimulus({ role: "assistant" });
    expect(stimulus1.hasModelOptions()).toBe(false);
    
    const stimulus2 = new Stimulus({ 
      role: "assistant", 
      temperature: 0.5 
    });
    expect(stimulus2.hasModelOptions()).toBe(true);
    
    const stimulus3 = new Stimulus({ 
      role: "assistant", 
      maxTokens: 100 
    });
    expect(stimulus3.hasModelOptions()).toBe(true);
  });

  it('should include system context in prompt', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      systemContext: "You are working in a secure environment with limited access."
    });
    
    const prompt = stimulus.getPrompt();
    expect(prompt).toContain("Additional Context");
    expect(prompt).toContain("secure environment");
  });

  it('should include tool usage limits', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      tools: { calculator: calculatorTool },
      maxToolSteps: 3
    });
    
    const prompt = stimulus.getPrompt();
    expect(prompt).toContain("Tool Usage Limits");
    expect(prompt).toContain("Maximum tool steps: 3");
  });
});

describe('Stimulus skills', () => {
  it('should include skills metadata in prompt when skills are provided', () => {
    const stimulus = new Stimulus({
      role: "assistant",
      skills: [
        { name: "deploy", description: "Deploy the app", instructions: "Run deploy script.", path: "/fake/deploy" },
      ],
    });
    const prompt = stimulus.getPrompt();
    expect(prompt).toContain("Available Skills");
    expect(prompt).toContain("deploy");
    expect(prompt).toContain("Deploy the app");
  });

  it('getSkillsRegistry returns registry when skills are set', () => {
    const stimulus = new Stimulus({
      skills: [{ name: "x", description: "X skill", instructions: "Do X.", path: "/fake/x" }],
    });
    const reg = stimulus.getSkillsRegistry();
    expect(reg).not.toBeNull();
    expect(reg!.listSkills()).toHaveLength(1);
    expect(reg!.activateSkill("x")).toBe("Do X.");
  });

  it('addSkillsTool adds skill tool when registry has skills', () => {
    const stimulus = new Stimulus({
      skills: [{ name: "y", description: "Y skill", instructions: "Do Y.", path: "/fake/y" }],
    });
    stimulus.addSkillsTool();
    const tools = stimulus.getTools();
    expect(tools["skill"]).toBeDefined();
  });
});