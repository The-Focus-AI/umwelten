import { AgentInteraction } from "../../interaction/agent-interaction.js";
import { ModelDetails } from "../../cognition/types.js";

/**
 * AgentInterface - Handles autonomous agent interactions
 * 
 * Provides event-driven interface for agents that can respond to external triggers
 */
export class AgentInterface {
  private agentInteraction: AgentInteraction;
  private isActive: boolean = false;
  private triggers: Map<string, (input: any) => Promise<void>> = new Map();
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(
    modelDetails: ModelDetails,
    agentRole: string,
    capabilities: string[] = []
  ) {
    this.agentInteraction = new AgentInteraction(modelDetails, agentRole, capabilities);
  }

  /**
   * Start the agent with specified triggers
   */
  async startAgent(triggers: {
    [triggerName: string]: {
      type: 'file-change' | 'api-call' | 'schedule' | 'webhook' | 'custom';
      handler: (input: any) => Promise<void>;
    }
  }): Promise<void> {
    this.isActive = true;
    
    console.log(`Starting agent: ${this.agentInteraction.getAgentStatus().role}`);
    console.log("Available tools:", this.agentInteraction.getAgentStatus().availableTools.join(", "));
    console.log("Registered triggers:", Object.keys(triggers).join(", "));
    console.log();

    // Register triggers
    for (const [triggerName, triggerConfig] of Object.entries(triggers)) {
      this.registerTrigger(triggerName, triggerConfig.handler);
    }

    // Emit agent started event
    this.emit('agent-started', { 
      role: this.agentInteraction.getAgentStatus().role,
      triggers: Object.keys(triggers)
    });
  }

  /**
   * Register a trigger handler
   */
  private registerTrigger(triggerName: string, handler: (input: any) => Promise<void>): void {
    this.triggers.set(triggerName, handler);
  }

  /**
   * Handle a trigger event
   */
  async handleTrigger(triggerName: string, input: any): Promise<void> {
    if (!this.isActive) {
      console.warn(`Agent is not active, ignoring trigger: ${triggerName}`);
      return;
    }

    const handler = this.triggers.get(triggerName);
    if (!handler) {
      console.warn(`No handler registered for trigger: ${triggerName}`);
      return;
    }

    try {
      console.log(`Handling trigger: ${triggerName}`);
      await handler(input);
    } catch (error) {
      console.error(`Error handling trigger ${triggerName}:`, error);
      this.emit('trigger-error', { triggerName, error });
    }
  }

  /**
   * Execute a direct task
   */
  async executeTask(task: string): Promise<string> {
    if (!this.isActive) {
      throw new Error("Agent is not active");
    }

    try {
      this.emit('task-started', { task });
      const response = await this.agentInteraction.executeTask(task);
      this.emit('task-completed', { task, response });
      return response;
    } catch (error) {
      this.emit('task-error', { task, error });
      throw error;
    }
  }

  /**
   * Plan a task without executing
   */
  async planTask(task: string): Promise<string> {
    if (!this.isActive) {
      throw new Error("Agent is not active");
    }

    try {
      this.emit('planning-started', { task });
      const plan = await this.agentInteraction.planTask(task);
      this.emit('planning-completed', { task, plan });
      return plan;
    } catch (error) {
      this.emit('planning-error', { task, error });
      throw error;
    }
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.isActive = false;
    this.triggers.clear();
    this.emit('agent-stopped', {});
  }

  /**
   * Check if agent is active
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get agent status
   */
  getStatus(): {
    isActive: boolean;
    role: string;
    capabilities: string[];
    availableTools: string[];
    registeredTriggers: string[];
  } {
    const agentStatus = this.agentInteraction.getAgentStatus();
    
    return {
      isActive: this.isActive,
      role: agentStatus.role,
      capabilities: agentStatus.capabilities,
      availableTools: agentStatus.availableTools,
      registeredTriggers: Array.from(this.triggers.keys())
    };
  }

  /**
   * Event system for agent lifecycle
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Get the underlying agent interaction
   */
  getInteraction(): AgentInteraction {
    return this.agentInteraction;
  }
}

/**
 * Example usage patterns for different agent types
 */
export class FileWatcherAgent extends AgentInterface {
  constructor(modelDetails: ModelDetails) {
    super(modelDetails, "File System Monitor", [
      "Monitor file changes",
      "Analyze file content",
      "Generate reports",
      "Notify on changes"
    ]);
  }

  async watchFile(filePath: string): Promise<void> {
    // This would integrate with file system watchers
    console.log(`Watching file: ${filePath}`);
  }
}

export class APIAgent extends AgentInterface {
  constructor(modelDetails: ModelDetails) {
    super(modelDetails, "API Integration Agent", [
      "Make API calls",
      "Process responses",
      "Handle errors",
      "Transform data"
    ]);
  }

  async callAPI(endpoint: string, data: any): Promise<void> {
    // This would integrate with HTTP clients
    console.log(`Calling API: ${endpoint}`);
  }
}

export class ScheduledAgent extends AgentInterface {
  constructor(modelDetails: ModelDetails) {
    super(modelDetails, "Scheduled Task Agent", [
      "Execute scheduled tasks",
      "Generate reports",
      "Send notifications",
      "Maintain schedules"
    ]);
  }

  async scheduleTask(task: string, schedule: string): Promise<void> {
    // This would integrate with cron or similar scheduling
    console.log(`Scheduling task: ${task} with schedule: ${schedule}`);
  }
}
