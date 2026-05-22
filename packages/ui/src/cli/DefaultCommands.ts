import { CLICommand } from "./CommandRegistry.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";

/**
 * Default CLI commands that can be registered with the CommandRegistry
 * 
 * These commands provide common functionality across different interaction types
 */

/**
 * Help command - shows available commands
 */
export const helpCommand: CLICommand = {
  trigger: "/?",
  description: "Show this help message",
  execute: async (interaction: Interaction, args?: string[]) => {
    // This will be handled by the CLIInterface to show the registry's help
    console.log("Use the registry's getHelpText() method to show help");
  }
};

/**
 * Reset command - clears conversation history
 */
export const resetCommand: CLICommand = {
  trigger: "/reset",
  description: "Clear the conversation history",
  execute: async (interaction: Interaction, args?: string[]) => {
    interaction.clearContext();
    console.log("Conversation history cleared.");
  }
};

/**
 * History command - shows conversation history
 */
export const historyCommand: CLICommand = {
  trigger: "/history",
  description: "Show chat message history",
  execute: async (interaction: Interaction, args?: string[]) => {
    console.log("Conversation history:");
    const messages = interaction.getMessages().filter(msg => msg.role !== "system");
    if (messages.length === 0) {
      console.log("No messages in history.");
    } else {
      messages.forEach(msg => {
        console.log(`${msg.role}: ${msg.content}`);
      });
    }
  }
};

/**
 * Exit command - ends the session
 */
export const exitCommand: CLICommand = {
  trigger: "/exit",
  description: "End the current session",
  execute: async (interaction: Interaction, args?: string[]) => {
    console.log("Ending session...");
    // This will be handled by the CLIInterface to stop the session
  }
};

/**
 * Stats command - shows response statistics
 */
export const statsCommand: CLICommand = {
  trigger: "/stats",
  description: "Show statistics for the last response",
  execute: async (interaction: Interaction, args?: string[]) => {
    // This will be handled by the CLIInterface to show stats
    console.log("Use the CLIInterface's displayStats() method to show stats");
  }
};

/**
 * Info command - shows current settings and information
 */
export const infoCommand: CLICommand = {
  trigger: "/info",
  description: "Show current settings and information",
  execute: async (interaction: Interaction, args?: string[]) => {
    // This will be handled by the CLIInterface to show info
    console.log("Use the CLIInterface's displayInfo() method to show info");
  }
};

/**
 * Toggle stats command - toggles automatic display of stats
 */
export const toggleStatsCommand: CLICommand = {
  trigger: "/toggle-stats",
  description: "Toggle automatic display of response statistics",
  execute: async (interaction: Interaction, args?: string[]) => {
    // This will be handled by the CLIInterface to toggle stats
    console.log("Use the CLIInterface's toggleStats() method to toggle stats");
  }
};

/**
 * Get all default commands
 * 
 * @returns Array of all default commands
 */
export function getDefaultCommands(): CLICommand[] {
  return [
    helpCommand,
    resetCommand,
    historyCommand,
    statsCommand,
    infoCommand,
    toggleStatsCommand,
    exitCommand
  ];
}

/**
 * Get chat-specific commands
 * 
 * @returns Array of commands suitable for chat interactions
 */
export function getChatCommands(): CLICommand[] {
  return [
    helpCommand,
    resetCommand,
    historyCommand,
    statsCommand,
    infoCommand,
    toggleStatsCommand,
    exitCommand
  ];
}

/**
 * Get agent-specific commands
 * 
 * @returns Array of commands suitable for agent interactions
 */
export function getAgentCommands(): CLICommand[] {
  return [
    helpCommand,
    resetCommand,
    historyCommand,
    statsCommand,
    infoCommand,
    toggleStatsCommand,
    exitCommand
  ];
}

/**
 * Get evaluation-specific commands
 * 
 * @returns Array of commands suitable for evaluation interactions
 */
export function getEvaluationCommands(): CLICommand[] {
  return [
    helpCommand,
    statsCommand,
    infoCommand,
    exitCommand
  ];
}
