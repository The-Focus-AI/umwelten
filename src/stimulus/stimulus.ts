import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ModelOptions } from "../cognition/types.js";
import { Tool } from "ai";
import type { SkillDefinition } from "./skills/types.js";
import {
  SkillsRegistry,
  loadSkillsFromDirectory,
  loadSkillsFromGit,
  createSkillTool,
} from "./skills/index.js";

export type StimulusOptions = {
  id?: string;
  name?: string;
  description?: string;
  role?: string;
  objective?: string;
  instructions?: string[];
  reasoning?: string;
  output?: string[];
  examples?: (string | { input: string; output: string })[];
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
  // Additional context
  systemContext?: string;
  // Skills (optional): direct list and/or load from dirs / git
  skills?: SkillDefinition[];
  skillsDirs?: string[];
  skillsFromGit?: string[];
  /** Root directory for cloning git repos (work or session dir). Required for skillsFromGit; no global cache. */
  skillsCacheRoot?: string;
}

export class Stimulus {
  public options: StimulusOptions;
  private tools: Record<string, Tool> = {};
  private skillsRegistry: SkillsRegistry | null = null;

  constructor(options?: StimulusOptions) {
    this.options = options || { role: "helpful assistant" };
    this.tools = options?.tools || {};
    if (options?.skills?.length) {
      this.skillsRegistry = new SkillsRegistry();
      this.skillsRegistry.addSkills(options.skills);
    }
  }

  // Getters for common properties
  get id(): string | undefined {
    return this.options.id;
  }

  get name(): string | undefined {
    return this.options.name;
  }

  get description(): string | undefined {
    return this.options.description;
  }

  get role(): string | undefined {
    return this.options.role;
  }

  get objective(): string | undefined {
    return this.options.objective;
  }

  get instructions(): string[] | undefined {
    return this.options.instructions;
  }

  get output(): string[] | undefined {
    return this.options.output;
  }

  get examples(): (string | { input: string; output: string })[] | undefined {
    return this.options.examples;
  }

  get temperature(): number | undefined {
    return this.options.temperature;
  }

  get maxTokens(): number | undefined {
    return this.options.maxTokens;
  }

  get runnerType(): 'base' | 'memory' | undefined {
    return this.options.runnerType;
  }

  get topP(): number | undefined {
    return this.options.topP;
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

  setOutputSchema(schema: z.ZodType<any>) {
    const schemaString = JSON.stringify(zodToJsonSchema(schema as any), null, 2);
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
  getModelOptions(): Partial<ModelOptions> & { topP?: number; frequencyPenalty?: number; presencePenalty?: number } {
    return {
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      topP: this.options.topP,
      frequencyPenalty: this.options.frequencyPenalty,
      presencePenalty: this.options.presencePenalty,
    };
  }

  hasModelOptions(): boolean {
    return this.options.temperature !== undefined || 
           this.options.maxTokens !== undefined ||
           this.options.topP !== undefined ||
           this.options.frequencyPenalty !== undefined ||
           this.options.presencePenalty !== undefined;
  }

  // NEW: Runner type methods
  getRunnerType(): 'base' | 'memory' {
    return this.options.runnerType || 'base';
  }

  /** Load skills from options.skillsDirs and options.skillsFromGit; merge into registry. No-op if only options.skills was set (already built in constructor). Git repos are cloned into options.skillsCacheRoot (work/session scoped); no global cache. */
  async loadSkills(): Promise<void> {
    const { skillsDirs, skillsFromGit, skillsCacheRoot } = this.options;
    if (!skillsDirs?.length && !skillsFromGit?.length) return;
    if (!this.skillsRegistry) this.skillsRegistry = new SkillsRegistry();
    if (this.options.skills?.length) this.skillsRegistry.addSkills(this.options.skills);
    for (const dir of skillsDirs ?? []) {
      const skills = await loadSkillsFromDirectory(dir);
      this.skillsRegistry.addSkills(skills);
    }
    if (skillsFromGit?.length) {
      if (!skillsCacheRoot?.trim()) {
        console.warn('skillsFromGit is set but skillsCacheRoot is missing; skipping git skills. Set skillsCacheRoot (e.g. work dir/repos) to clone repos.');
      } else {
        for (const repo of skillsFromGit) {
          const skills = await loadSkillsFromGit(repo, skillsCacheRoot);
          if (skills.length) this.skillsRegistry.addSkills(skills);
        }
      }
    }
  }

  getSkillsRegistry(): SkillsRegistry | null {
    return this.skillsRegistry;
  }

  /** Add the skill tool so the agent can activate skills by name. No-op if registry is empty. */
  addSkillsTool(): void {
    if (this.skillsRegistry?.hasSkills()) {
      this.addTool('skill', createSkillTool(this.skillsRegistry));
    }
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
        // Handle different tool object structures
        const description = tool.description || 
                          (tool as any).inputSchema?.description || 
                          'No description available';
        prompt.push(`- ${name}: ${description}`);
      });
      
      if (this.options.toolInstructions) {
        prompt.push(`\n# Tool Usage Instructions\n- ${this.options.toolInstructions.join('\n- ')}`);
      }
      
      if (this.options.maxToolSteps) {
        prompt.push(`\n# Tool Usage Limits\n- Maximum tool steps: ${this.options.maxToolSteps}`);
      }
    }
    
    // Add system context if provided
    if (this.options.systemContext) {
      prompt.push(`\n# Additional Context\n${this.options.systemContext}`);
    }

    // Add skills metadata (progressive disclosure) if registry has skills
    if (this.skillsRegistry?.hasSkills()) {
      const skillsBlock = this.skillsRegistry.getSkillsMetadataPrompt();
      if (skillsBlock) prompt.push(`\n${skillsBlock}`);
    }

    return prompt.join("\n");
  }
}