import readline from "readline";
import { Interaction } from "../../interaction/core/interaction.js";
import { CommandRegistry, CLICommand } from "./CommandRegistry.js";

/**
 * CLIInterface - Handles command-line interface interactions
 * 
 * Provides readline-based input/output for different interaction types
 */
export class CLIInterface {
  private rl?: readline.Interface;
  private isActive: boolean = false;
  private commandRegistry: CommandRegistry;
  private lastResponse?: {
    startTime: number;
    endTime: number;
    promptTokens: number;
    completionTokens: number;
    totalCost?: number;
    modelName: string;
    provider: string;
  };
  private showStatsAfterResponse: boolean = false;

  constructor(commandRegistry?: CommandRegistry) {
    this.commandRegistry = commandRegistry || new CommandRegistry();
  }

  /**
   * Add a CLI command to the registry
   * 
   * @param command The command to add
   */
  addCommand(command: CLICommand): void {
    this.commandRegistry.addCommand(command);
  }

  /**
   * Add multiple CLI commands to the registry
   * 
   * @param commands Array of commands to add
   */
  addCommands(commands: CLICommand[]): void {
    this.commandRegistry.addCommands(commands);
  }

  /**
   * Remove a CLI command from the registry
   * 
   * @param trigger The command trigger to remove
   */
  removeCommand(trigger: string): void {
    this.commandRegistry.removeCommand(trigger);
  }

  /**
   * Get the command registry
   * 
   * @returns The command registry instance
   */
  getCommandRegistry(): CommandRegistry {
    return this.commandRegistry;
  }

  /**
   * Track a model response for statistics
   * 
   * @param startTime When the request started
   * @param endTime When the request completed
   * @param promptTokens Number of prompt tokens used
   * @param completionTokens Number of completion tokens used
   * @param totalCost Total cost of the request (if available)
   * @param modelName Name of the model used
   * @param provider Provider used
   */
  trackResponse(
    startTime: number,
    endTime: number,
    promptTokens: number,
    completionTokens: number,
    totalCost: number | undefined,
    modelName: string,
    provider: string
  ): void {
    this.lastResponse = {
      startTime,
      endTime,
      promptTokens,
      completionTokens,
      totalCost,
      modelName,
      provider
    };

    // Auto-display stats if enabled
    if (this.showStatsAfterResponse) {
      this.displayStats();
    }
  }

  /**
   * Display statistics for the last response
   */
  displayStats(): void {
    if (!this.lastResponse) {
      console.log("No response data available.");
      return;
    }

    const { startTime, endTime, promptTokens, completionTokens, totalCost, modelName, provider } = this.lastResponse;
    const duration = endTime - startTime;
    const totalTokens = promptTokens + completionTokens;

    console.log("\n📊 Response Statistics:");
    console.log("======================");
    console.log(`Model: ${modelName} (${provider})`);
    console.log(`Duration: ${duration.toFixed(0)}ms`);
    console.log(`Tokens: ${totalTokens.toLocaleString()} (${promptTokens.toLocaleString()} prompt + ${completionTokens.toLocaleString()} completion)`);
    
    if (totalCost !== undefined) {
      console.log(`Cost: $${totalCost.toFixed(6)}`);
    } else {
      console.log(`Cost: Not available`);
    }
    
    console.log("======================\n");
  }

  /**
   * Toggle automatic display of stats after each response
   * 
   * @param enabled Whether to show stats automatically
   */
  setShowStatsAfterResponse(enabled: boolean): void {
    this.showStatsAfterResponse = enabled;
  }

  /**
   * Get whether stats are shown after each response
   * 
   * @returns True if stats are shown automatically
   */
  getShowStatsAfterResponse(): boolean {
    return this.showStatsAfterResponse;
  }

  /**
   * Get the last response data
   * 
   * @returns Last response data or undefined
   */
  getLastResponse() {
    return this.lastResponse;
  }

  /**
   * Display current settings and information
   */
  displayInfo(): void {
    console.log("\nℹ️  Current Settings:");
    console.log("===================");
    console.log(`Auto-display stats: ${this.showStatsAfterResponse ? 'Enabled' : 'Disabled'}`);
    console.log(`Registered commands: ${this.commandRegistry.getCommandCount()}`);
    
    if (this.lastResponse) {
      const { modelName, provider } = this.lastResponse;
      console.log(`Last model: ${modelName} (${provider})`);
    } else {
      console.log(`Last model: None`);
    }
    
    console.log("===================\n");
  }

  /**
   * Toggle automatic display of stats
   */
  toggleStats(): void {
    this.showStatsAfterResponse = !this.showStatsAfterResponse;
    console.log(`Auto-display stats: ${this.showStatsAfterResponse ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Start an interactive chat session
   */
  async startChat(interaction: Interaction): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    this.isActive = true;
    console.log("Starting chat session. Type 'exit' or 'quit' to end.\n");

    // Start the chat loop
    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const message = line.trim();
      
      if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
        this.stop();
        return;
      }

      if (message === "") {
        this.rl?.prompt();
        return;
      }

      // Check for registered commands first
      const commandExecuted = await this.handleCommand(message, interaction);
      if (commandExecuted) {
        return;
      }

      try {
        // Add user message and get response
        interaction.addMessage({ role: "user", content: message });
        
        // Pause readline to prevent interference with streaming
        this.rl?.pause();
        
        // Clear the current line and write the model response
        process.stdout.write("\r\x1b[K"); // Clear current line
        process.stdout.write("Model: ");
        
        const startTime = Date.now();
        const response = await interaction.streamText();
        const endTime = Date.now();
        
        // Write the response with proper formatting
        if (response.content && response.content.trim()) {
          process.stdout.write(response.content);
        } else {
          process.stdout.write("[No response content received]");
        }
        process.stdout.write("\n\n");
        
        // Track response statistics
        this.trackResponse(
          startTime,
          endTime,
          response.metadata?.tokenUsage?.promptTokens || 0,
          response.metadata?.tokenUsage?.completionTokens || 0,
          response.metadata?.tokenUsage?.total,
          interaction.modelDetails.name,
          interaction.modelDetails.provider
        );
        
      } catch (error) {
        console.error("Error:", error);
      } finally {
        // Resume readline and prompt for next input
        this.rl?.resume();
        this.rl?.prompt();
      }
    });

    this.rl.on("close", () => {
      console.log("Chat session ended.");
      this.isActive = false;
    });
  }

  /**
   * Start an evaluation session
   */
  async startEvaluation(interaction: Interaction): Promise<void> {
    console.log("Starting evaluation session...\n");
    
    try {
      const response = await interaction.generateText();
      console.log("Evaluation Result:");
      console.log("==================");
      console.log(response);
      console.log("\nEvaluation completed.");
    } catch (error) {
      console.error("Evaluation failed:", error);
    }
  }

  /**
   * Start an agent session
   */
  async startAgent(interaction: Interaction): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "Agent Task: ",
    });

    this.isActive = true;
    console.log("Starting agent session. Type 'exit' or 'quit' to end.\n");
    console.log("Agent Role:", interaction.stimulus.options.role || "assistant");
    console.log("Available Tools:", interaction.stimulus.hasTools() ? Object.keys(interaction.stimulus.getTools()).join(", ") : "none");
    console.log();

    this.rl.on("line", async (line) => {
      const task = line.trim();
      
      if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") {
        this.stop();
        return;
      }

      if (task === "") {
        this.rl?.prompt();
        return;
      }

      // Check for registered commands first
      const commandExecuted = await this.handleCommand(task, interaction);
      if (commandExecuted) {
        return;
      }

      try {
        // Pause readline to prevent interference with streaming
        this.rl?.pause();
        
        // Clear the current line and write the agent response
        process.stdout.write("\r\x1b[K"); // Clear current line
        process.stdout.write("Agent: ");
        
        // Add the task as a user message and execute
        interaction.addMessage({ role: "user", content: task });
        const startTime = Date.now();
        const response = await interaction.streamText();
        const endTime = Date.now();
        
        // Write the response with proper formatting
        process.stdout.write(response.content);
        process.stdout.write("\n\n");
        
        // Track response statistics
        this.trackResponse(
          startTime,
          endTime,
          response.metadata?.tokenUsage?.promptTokens || 0,
          response.metadata?.tokenUsage?.completionTokens || 0,
          response.metadata?.tokenUsage?.total,
          interaction.modelDetails.name,
          interaction.modelDetails.provider
        );
        
      } catch (error) {
        console.error("Agent error:", error);
      } finally {
        // Resume readline and prompt for next input
        this.rl?.resume();
        this.rl?.prompt();
      }
    });

    this.rl.on("close", () => {
      console.log("Agent session ended.");
      this.isActive = false;
    });
  }

  /**
   * Handle command execution
   * 
   * @param input The user input to check for commands
   * @param interaction The interaction context
   * @returns True if a command was executed
   */
  private async handleCommand(input: string, interaction: Interaction): Promise<boolean> {
    // Check if input starts with a command trigger
    const command = this.commandRegistry.getAllCommands().find(cmd => 
      input.startsWith(cmd.trigger)
    );

    if (!command) {
      return false;
    }

    // Handle special cases
    if (command.trigger === "/?") {
      this.rl?.pause();
      console.log(this.commandRegistry.getHelpText());
      this.rl?.resume();
      this.rl?.prompt();
      return true;
    }

    if (command.trigger === "/exit") {
      this.stop();
      return true;
    }

    if (command.trigger === "/stats") {
      this.rl?.pause();
      this.displayStats();
      this.rl?.resume();
      this.rl?.prompt();
      return true;
    }

    if (command.trigger === "/info") {
      this.rl?.pause();
      this.displayInfo();
      this.rl?.resume();
      this.rl?.prompt();
      return true;
    }

    if (command.trigger === "/toggle-stats") {
      this.rl?.pause();
      this.toggleStats();
      this.rl?.resume();
      this.rl?.prompt();
      return true;
    }

    // Execute the command
    if (command.pauseReadline !== false) {
      this.rl?.pause();
    }

    try {
      await command.execute(interaction);
    } finally {
      if (command.pauseReadline !== false) {
        this.rl?.resume();
        this.rl?.prompt();
      }
    }

    return true;
  }


  /**
   * Stop the interface
   */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    this.isActive = false;
  }

  /**
   * Check if the interface is active
   */
  isRunning(): boolean {
    return this.isActive;
  }
}
