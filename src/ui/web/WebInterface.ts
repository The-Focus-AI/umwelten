import { Interaction } from "../../interaction/interaction.js";
import { ChatInteraction } from "../../interaction/chat-interaction.js";
import { EvaluationInteraction } from "../../interaction/evaluation-interaction.js";
import { AgentInteraction } from "../../interaction/agent-interaction.js";

/**
 * WebInterface - Handles web-based interface interactions
 * 
 * Provides React-compatible hooks and state management for web applications
 */
export class WebInterface {
  private interaction: Interaction;
  private messages: Array<{ role: string; content: string; timestamp: Date }> = [];
  private isLoading: boolean = false;

  constructor(interaction: Interaction) {
    this.interaction = interaction;
  }

  /**
   * Get current messages
   */
  getMessages(): Array<{ role: string; content: string; timestamp: Date }> {
    return this.messages;
  }

  /**
   * Check if currently loading
   */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Send a message and get response (for chat interactions)
   */
  async sendMessage(content: string): Promise<string> {
    if (this.isLoading) {
      throw new Error("Already processing a message");
    }

    this.isLoading = true;
    
    try {
      // Add user message
      this.messages.push({
        role: "user",
        content,
        timestamp: new Date()
      });

      // Add to interaction
      this.interaction.addMessage({ role: "user", content });

      // Get response
      const response = await this.interaction.streamText();
      
      // Add assistant message
      this.messages.push({
        role: "assistant",
        content: response.content,
        timestamp: new Date()
      });

      return response.content;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Run an evaluation (for evaluation interactions)
   */
  async runEvaluation(): Promise<string> {
    if (!(this.interaction instanceof EvaluationInteraction)) {
      throw new Error("Interaction must be an EvaluationInteraction");
    }

    this.isLoading = true;
    
    try {
      const response = await this.interaction.evaluate();
      
      this.messages.push({
        role: "assistant",
        content: response,
        timestamp: new Date()
      });

      return response;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Execute an agent task (for agent interactions)
   */
  async executeAgentTask(task: string): Promise<string> {
    if (!(this.interaction instanceof AgentInteraction)) {
      throw new Error("Interaction must be an AgentInteraction");
    }

    this.isLoading = true;
    
    try {
      // Add user message
      this.messages.push({
        role: "user",
        content: task,
        timestamp: new Date()
      });

      const response = await this.interaction.executeTask(task);
      
      // Add assistant message
      this.messages.push({
        role: "assistant",
        content: response,
        timestamp: new Date()
      });

      return response;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.messages = [];
    this.interaction.clearContext();
  }

  /**
   * Get interaction status
   */
  getStatus(): {
    type: string;
    isActive: boolean;
    messageCount: number;
    availableTools: string[];
  } {
    let type = "unknown";
    let availableTools: string[] = [];

    if (this.interaction instanceof ChatInteraction) {
      type = "chat";
      availableTools = Object.keys(this.interaction.getVercelTools() || {});
    } else if (this.interaction instanceof EvaluationInteraction) {
      type = "evaluation";
      availableTools = Object.keys(this.interaction.getVercelTools() || {});
    } else if (this.interaction instanceof AgentInteraction) {
      type = "agent";
      const status = this.interaction.getAgentStatus();
      availableTools = status.availableTools;
    }

    return {
      type,
      isActive: !this.isLoading,
      messageCount: this.messages.length,
      availableTools
    };
  }
}

/**
 * React hook for web interface
 * This would be used in a React component
 */
export function useWebInterface(interaction: Interaction) {
  const webInterface = new WebInterface(interaction);
  
  return {
    messages: webInterface.getMessages(),
    isLoading: webInterface.getIsLoading(),
    sendMessage: webInterface.sendMessage.bind(webInterface),
    runEvaluation: webInterface.runEvaluation.bind(webInterface),
    executeAgentTask: webInterface.executeAgentTask.bind(webInterface),
    clearHistory: webInterface.clearHistory.bind(webInterface),
    status: webInterface.getStatus()
  };
}
