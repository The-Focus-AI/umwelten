import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ModelOptions } from "../cognition/types.js";
import { Tool } from "ai";

export type StimulusOptions = {
  role?: string;
  objective?: string;
  instructions?: string[];
  reasoning?: string;
  output?: string[];
  examples?: string[];
  // NEW: Tool management
  tools?: Record<string, Tool>;
  toolInstructions?: string[];
  maxToolSteps?: number;
  // NEW: Model options
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // NEW: Runner configuration
  runnerType?: 'base' | 'memory';
  // NEW: Additional context
  systemContext?: string;
}

export class Stimulus {
  public options: StimulusOptions;
  private tools: Record<string, Tool> = {};

  constructor(options?: StimulusOptions) {
    this.options = options || { role: "helpful assistant" };
    this.tools = options?.tools || {};
  }

  // Existing methods...
  setRole(role: string) {
    this.options.role = role;
  }

  setObjective(objective: string) {
    this.options.objective = objective;
  }

  addInstruction(instruction: string) {
    this.options.instructions = this.options.instructions || [];
    this.options.instructions.push(instruction);
  }

  addOutput(output: string) {
    this.options.output = this.options.output || [];
    this.options.output.push(output);
  }

  setOutputSchema(schema: z.ZodSchema) {
    const schemaString = JSON.stringify(zodToJsonSchema(schema), null, 2);
    this.options.output = [schemaString];
  }

  // NEW: Tool management methods
  addTool(name: string, tool: Tool): void {
    this.tools[name] = tool;
  }

  setTools(tools: Record<string, Tool>): void {
    this.tools = tools;
  }

  getTools(): Record<string, Tool> {
    return this.tools;
  }

  hasTools(): boolean {
    return Object.keys(this.tools).length > 0;
  }

  // NEW: Model options methods
  getModelOptions(): ModelOptions {
    return {
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
    };
  }

  hasModelOptions(): boolean {
    return this.options.temperature !== undefined || 
           this.options.maxTokens !== undefined;
  }

  // NEW: Runner type methods
  getRunnerType(): 'base' | 'memory' {
    return this.options.runnerType || 'base';
  }

  // Enhanced prompt generation
  getPrompt(): string {
    let prompt = [];
    
    // Existing prompt generation...
    if (this.options.role) {
      prompt.push(`You are a ${this.options.role}.`);
    }
    if (this.options.objective) {
      prompt.push(`Your objective is to ${this.options.objective}.`);
    }
    if (this.options.instructions) {
      prompt.push(`\n# Instructions\n- ${this.options.instructions.join("\n- ")}\n`);
    }
    if (this.options.reasoning) {
      prompt.push(`Your reasoning is to ${this.options.reasoning}.`);
    }
    if (this.options.output) {
      prompt.push(`\n# Output Format\n- ${this.options.output.join("\n- ")}\n`);
    }
    if (this.options.examples) {
      prompt.push(`Your examples are to ${this.options.examples}.`);
    }
    
    // NEW: Add tool context to prompt
    if (this.hasTools()) {
      prompt.push(`\n# Available Tools\nYou have access to the following tools:`);
      Object.entries(this.tools).forEach(([name, tool]) => {
        prompt.push(`- ${name}: ${tool.description || 'No description available'}`);
      });
      
      if (this.options.toolInstructions) {
        prompt.push(`\n# Tool Usage Instructions\n- ${this.options.toolInstructions.join('\n- ')}`);
      }
      
      if (this.options.maxToolSteps) {
        prompt.push(`\n# Tool Usage Limits\n- Maximum tool steps: ${this.options.maxToolSteps}`);
      }
    }
    
    // NEW: Add system context if provided
    if (this.options.systemContext) {
      prompt.push(`\n# Additional Context\n${this.options.systemContext}`);
    }
    
    return prompt.join("\n");
  }
}