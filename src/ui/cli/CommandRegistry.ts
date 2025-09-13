import { Interaction } from "../../interaction/interaction.js";

/**
 * Represents a CLI command that can be executed
 */
export interface CLICommand {
  /** The command trigger (e.g., "/help", "/reset") */
  trigger: string;
  /** Description of what the command does */
  description: string;
  /** Function to execute when the command is triggered */
  execute: (interaction: Interaction, args?: string[]) => Promise<void> | void;
  /** Whether the command should pause readline during execution */
  pauseReadline?: boolean;
}

/**
 * Registry for managing CLI commands
 * 
 * Provides a centralized way to register, manage, and execute CLI commands
 * across different interaction types (chat, agent, evaluation, etc.)
 */
export class CommandRegistry {
  private commands: Map<string, CLICommand> = new Map();
  private helpCommands: string[] = [];

  /**
   * Register a new CLI command
   * 
   * @param command The command to register
   */
  addCommand(command: CLICommand): void {
    this.commands.set(command.trigger, command);
    
    // Add to help if it has a description
    if (command.description) {
      this.helpCommands.push(command.trigger);
    }
  }

  /**
   * Register multiple commands at once
   * 
   * @param commands Array of commands to register
   */
  addCommands(commands: CLICommand[]): void {
    commands.forEach(command => this.addCommand(command));
  }

  /**
   * Remove a command from the registry
   * 
   * @param trigger The command trigger to remove
   */
  removeCommand(trigger: string): void {
    this.commands.delete(trigger);
    this.helpCommands = this.helpCommands.filter(cmd => cmd !== trigger);
  }

  /**
   * Check if a command exists
   * 
   * @param trigger The command trigger to check
   * @returns True if the command exists
   */
  hasCommand(trigger: string): boolean {
    return this.commands.has(trigger);
  }

  /**
   * Execute a command if it exists
   * 
   * @param trigger The command trigger
   * @param interaction The interaction context
   * @param args Optional arguments for the command
   * @returns True if the command was found and executed
   */
  async executeCommand(trigger: string, interaction: Interaction, args?: string[]): Promise<boolean> {
    const command = this.commands.get(trigger);
    if (!command) {
      return false;
    }

    try {
      await command.execute(interaction, args);
      return true;
    } catch (error) {
      console.error(`Error executing command '${trigger}':`, error);
      return true; // Still return true since we found and attempted to execute the command
    }
  }

  /**
   * Get all registered commands
   * 
   * @returns Array of all registered commands
   */
  getAllCommands(): CLICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get help text for all registered commands
   * 
   * @returns Formatted help text
   */
  getHelpText(): string {
    if (this.helpCommands.length === 0) {
      return "No commands available.";
    }

    const helpLines = ["Available commands:"];
    
    // Sort commands alphabetically for consistent display
    const sortedCommands = this.helpCommands
      .map(trigger => this.commands.get(trigger)!)
      .sort((a, b) => a.trigger.localeCompare(b.trigger));

    for (const command of sortedCommands) {
      helpLines.push(`  ${command.trigger.padEnd(12)} ${command.description}`);
    }

    return helpLines.join("\n");
  }

  /**
   * Clear all registered commands
   */
  clear(): void {
    this.commands.clear();
    this.helpCommands = [];
  }

  /**
   * Get the number of registered commands
   * 
   * @returns Number of registered commands
   */
  getCommandCount(): number {
    return this.commands.size;
  }
}

/**
 * Default command registry instance
 * This can be used as a singleton or imported for specific use cases
 */
export const defaultCommandRegistry = new CommandRegistry();
