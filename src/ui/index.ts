// Interaction classes
export { Interaction } from '../interaction/interaction.js';
export { ChatInteraction } from '../interaction/chat-interaction.js';
export { EvaluationInteraction } from '../interaction/evaluation-interaction.js';
export { AgentInteraction } from '../interaction/agent-interaction.js';

// Interface classes
export { CLIInterface } from './cli/CLIInterface.js';
export { WebInterface, useWebInterface } from './web/WebInterface.js';
export { 
  AgentInterface, 
  FileWatcherAgent, 
  APIAgent, 
  ScheduledAgent 
} from './agent/AgentInterface.js';

// Re-export types
export type { ModelDetails, ModelOptions, ModelResponse } from '../cognition/types.js';
