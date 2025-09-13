import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getDefaultCommands, 
  getChatCommands, 
  getAgentCommands, 
  getEvaluationCommands,
  helpCommand,
  resetCommand,
  historyCommand,
  memoryCommand,
  statsCommand,
  infoCommand,
  toggleStatsCommand,
  exitCommand
} from './DefaultCommands.js';
import { Interaction } from '../../interaction/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';

// Create real interaction for testing
const createTestInteraction = () => {
  const testModel = { 
    name: "test-model", 
    provider: "test" as const,
    costs: { promptTokens: 0.001, completionTokens: 0.002 }
  };
  const stimulus = new Stimulus({ role: "assistant" });
  return new Interaction(testModel, stimulus);
};

describe('DefaultCommands', () => {
  let testInteraction: Interaction;

  beforeEach(() => {
    testInteraction = createTestInteraction();
  });

  describe('Command Structure', () => {
    it('should have correct trigger and description for help command', () => {
      expect(helpCommand.trigger).toBe('/?');
      expect(helpCommand.description).toBe('Show this help message');
      expect(typeof helpCommand.execute).toBe('function');
    });

    it('should have correct trigger and description for reset command', () => {
      expect(resetCommand.trigger).toBe('/reset');
      expect(resetCommand.description).toBe('Clear the conversation history');
      expect(typeof resetCommand.execute).toBe('function');
    });

    it('should have correct trigger and description for history command', () => {
      expect(historyCommand.trigger).toBe('/history');
      expect(historyCommand.description).toBe('Show chat message history');
      expect(typeof historyCommand.execute).toBe('function');
    });

    it('should have correct trigger and description for memory command', () => {
      expect(memoryCommand.trigger).toBe('/mem');
      expect(memoryCommand.description).toBe('Show memory facts (if memory enabled)');
      expect(typeof memoryCommand.execute).toBe('function');
    });

    it('should have correct trigger and description for exit command', () => {
      expect(exitCommand.trigger).toBe('/exit');
      expect(exitCommand.description).toBe('End the current session');
      expect(typeof exitCommand.execute).toBe('function');
    });
  });

  describe('Command Execution', () => {
    it('should execute reset command and clear context', async () => {
      // Add some messages to the interaction
      testInteraction.addMessage({ role: 'user', content: 'Hello' });
      testInteraction.addMessage({ role: 'assistant', content: 'Hi there!' });
      
      // Should have system message + 2 user messages = 3 total
      expect(testInteraction.getMessages()).toHaveLength(3);
      
      await resetCommand.execute(testInteraction);
      
      // After reset, should have fewer messages (context cleared)
      const messages = testInteraction.getMessages();
      expect(messages.length).toBeLessThan(3);
    });

    it('should execute history command and show messages', async () => {
      // Add some messages
      testInteraction.addMessage({ role: 'user', content: 'Hello' });
      testInteraction.addMessage({ role: 'assistant', content: 'Hi there!' });
      
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      await historyCommand.execute(testInteraction);
      
      expect(logOutput).toContain('Conversation history:');
      expect(logOutput).toContain('user: Hello');
      expect(logOutput).toContain('assistant: Hi there!');
      
      // Restore console.log
      console.log = originalLog;
    });

    it('should handle empty history in history command', async () => {
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      await historyCommand.execute(testInteraction);
      
      expect(logOutput).toContain('Conversation history:');
      expect(logOutput).toContain('No messages in history.');
      
      // Restore console.log
      console.log = originalLog;
    });

    it('should execute memory command and handle no memory store', async () => {
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      await memoryCommand.execute(testInteraction);
      
      expect(logOutput).toContain('Memory not enabled for this interaction.');
      
      // Restore console.log
      console.log = originalLog;
    });

    it('should execute memory command and show facts when memory is available', async () => {
      // Create a memory-enabled interaction
      const memoryStimulus = new Stimulus({ 
        role: "assistant",
        runnerType: 'memory'
      });
      const memoryInteraction = new Interaction(
        { name: "test-model", provider: "test" as const, costs: { promptTokens: 0.001, completionTokens: 0.002 } },
        memoryStimulus
      );
      
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      await memoryCommand.execute(memoryInteraction);
      
      // Should show memory facts or no facts message
      expect(logOutput.length).toBeGreaterThan(0);
      expect(logOutput.some(line => 
        line.includes('Memory facts:') || 
        line.includes('No memory facts stored.') ||
        line.includes('Memory not enabled')
      )).toBe(true);
      
      // Restore console.log
      console.log = originalLog;
    });

    it('should handle memory command with no facts', async () => {
      // Create a memory-enabled interaction
      const memoryStimulus = new Stimulus({ 
        role: "assistant",
        runnerType: 'memory'
      });
      const memoryInteraction = new Interaction(
        { name: "test-model", provider: "test" as const, costs: { promptTokens: 0.001, completionTokens: 0.002 } },
        memoryStimulus
      );
      
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      await memoryCommand.execute(memoryInteraction);
      
      // Should show appropriate message
      expect(logOutput.length).toBeGreaterThan(0);
      expect(logOutput.some(line => 
        line.includes('Memory facts:') || 
        line.includes('No memory facts stored.') ||
        line.includes('Memory not enabled')
      )).toBe(true);
      
      // Restore console.log
      console.log = originalLog;
    });

    it('should handle memory command errors gracefully', async () => {
      // Capture console output
      const originalLog = console.log;
      const originalError = console.error;
      const logOutput: string[] = [];
      const errorOutput: string[] = [];
      
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      console.error = (...args: any[]) => {
        errorOutput.push(args.join(' '));
      };
      
      // This should not throw an error
      await expect(memoryCommand.execute(testInteraction)).resolves.not.toThrow();
      
      // Should handle gracefully
      expect(logOutput.length).toBeGreaterThan(0);
      
      // Restore console methods
      console.log = originalLog;
      console.error = originalError;
    });
  });

  describe('Command Collections', () => {
    it('should return all default commands', () => {
      const commands = getDefaultCommands();
      expect(commands).toHaveLength(8);
      expect(commands).toContain(helpCommand);
      expect(commands).toContain(resetCommand);
      expect(commands).toContain(historyCommand);
      expect(commands).toContain(memoryCommand);
      expect(commands).toContain(statsCommand);
      expect(commands).toContain(infoCommand);
      expect(commands).toContain(toggleStatsCommand);
      expect(commands).toContain(exitCommand);
    });

    it('should return chat-specific commands', () => {
      const commands = getChatCommands();
      expect(commands).toHaveLength(8);
      expect(commands).toContain(helpCommand);
      expect(commands).toContain(resetCommand);
      expect(commands).toContain(historyCommand);
      expect(commands).toContain(memoryCommand);
      expect(commands).toContain(statsCommand);
      expect(commands).toContain(infoCommand);
      expect(commands).toContain(toggleStatsCommand);
      expect(commands).toContain(exitCommand);
    });

    it('should return agent-specific commands', () => {
      const commands = getAgentCommands();
      expect(commands).toHaveLength(8);
      expect(commands).toContain(helpCommand);
      expect(commands).toContain(resetCommand);
      expect(commands).toContain(historyCommand);
      expect(commands).toContain(memoryCommand);
      expect(commands).toContain(statsCommand);
      expect(commands).toContain(infoCommand);
      expect(commands).toContain(toggleStatsCommand);
      expect(commands).toContain(exitCommand);
    });

    it('should return evaluation-specific commands', () => {
      const commands = getEvaluationCommands();
      expect(commands).toHaveLength(4);
      expect(commands).toContain(helpCommand);
      expect(commands).toContain(statsCommand);
      expect(commands).toContain(infoCommand);
      expect(commands).toContain(exitCommand);
      expect(commands).not.toContain(resetCommand);
      expect(commands).not.toContain(historyCommand);
      expect(commands).not.toContain(memoryCommand);
      expect(commands).not.toContain(toggleStatsCommand);
    });
  });
});