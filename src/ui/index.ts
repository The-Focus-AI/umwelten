// Interaction classes
export { Interaction } from '../interaction/interaction.js';

// Interface classes
export { CLIInterface } from './cli/CLIInterface.js';
export { CommandRegistry } from './cli/CommandRegistry.js';
export { 
  getChatCommands, 
  getAgentCommands, 
  getEvaluationCommands, 
  getDefaultCommands,
  statsCommand,
  infoCommand,
  toggleStatsCommand
} from './cli/DefaultCommands.js';
export {WebInterface} from './WebInterface.js';

// Re-export types
export type { ModelDetails, ModelOptions, ModelResponse } from '../cognition/types.js';
