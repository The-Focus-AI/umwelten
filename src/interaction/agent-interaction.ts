import { Interaction } from "./interaction.js";
import { ModelDetails, ModelOptions } from "../cognition/types.js";
// No default tools; caller must attach tools explicitly if desired

/**
 * AgentInteraction - Specialized interaction for autonomous agents
 * 
 * Pre-configured with:
 * - Agent-focused system prompt
 * - Memory-enabled runner for learning
 * - Comprehensive tool set
 * - Extended multi-step capabilities
 */
export class AgentInteraction extends Interaction {
  private agentRole: string;
  private capabilities: string[];

  constructor(
    modelDetails: ModelDetails, 
    agentRole: string, 
    capabilities: string[] = [],
    options?: ModelOptions
  ) {
    const systemPrompt = `You are an autonomous AI agent specialized in: ${agentRole}

Your capabilities include:
${capabilities.map(cap => `- ${cap}`).join('\n')}

As an autonomous agent, you should:
- Take initiative to accomplish goals
- Use tools proactively when needed
- Learn from interactions and remember important information
- Plan multi-step approaches to complex tasks
- Be resourceful and adaptive
- Communicate your reasoning and progress

You have access to various tools to help you accomplish your objectives. Use them strategically and efficiently.`;
    
    super(modelDetails, systemPrompt, options, 'memory'); // Use memory runner for learning
    
    this.agentRole = agentRole;
    this.capabilities = capabilities;
    // Enable extended multi-step tool calling for complex agent tasks
    this.setMaxSteps(10);
  }

  /**
   * Execute an agent task with planning and execution
   */
  async executeTask(task: string): Promise<string> {
    // Add the task as a user message
    this.addMessage({ 
      role: "user", 
      content: `Task: ${task}\n\nPlease plan and execute this task step by step. Use tools as needed and explain your reasoning.` 
    });
    
    const response = await this.streamText();
    return response.content;
  }

  /**
   * Get agent status and capabilities
   */
  getAgentStatus(): {
    role: string;
    capabilities: string[];
    availableTools: string[];
    memoryEnabled: boolean;
  } {
    return {
      role: this.agentRole,
      capabilities: this.capabilities,
      availableTools: Object.keys(this.tools || {}),
      memoryEnabled: true // Always true for agent interactions
    };
  }

  /**
   * Plan a multi-step approach to a complex task
   */
  async planTask(task: string): Promise<string> {
    this.addMessage({ 
      role: "user", 
      content: `Please create a detailed plan for this task: ${task}\n\nBreak it down into steps and identify which tools you'll need.` 
    });
    
    const response = await this.generateText();
    return response.content;
  }
}
