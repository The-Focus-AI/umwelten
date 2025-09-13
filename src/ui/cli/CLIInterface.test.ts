import { describe, it, expect, beforeEach } from 'vitest';
import { CLIInterface } from './CLIInterface.js';
import { CommandRegistry, CLICommand } from './CommandRegistry.js';
import { getChatCommands } from './DefaultCommands.js';
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

describe('CLIInterface', () => {
  let cliInterface: CLIInterface;
  let testInteraction: Interaction;

  beforeEach(() => {
    // Create test interaction
    testInteraction = createTestInteraction();
    
    // Create CLI interface
    cliInterface = new CLIInterface();
  });

  describe('Constructor and Command Management', () => {
    it('should create CLIInterface with default command registry', () => {
      const cli = new CLIInterface();
      expect(cli.getCommandRegistry()).toBeInstanceOf(CommandRegistry);
    });

    it('should create CLIInterface with custom command registry', () => {
      const customRegistry = new CommandRegistry();
      const cli = new CLIInterface(customRegistry);
      expect(cli.getCommandRegistry()).toBe(customRegistry);
    });

    it('should add single command', () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          console.log('Test command executed');
        }
      };

      cliInterface.addCommand(command);
      expect(cliInterface.getCommandRegistry().hasCommand('/test')).toBe(true);
    });

    it('should add multiple commands', () => {
      const commands = getChatCommands();
      cliInterface.addCommands(commands);
      
      expect(cliInterface.getCommandRegistry().hasCommand('/?')).toBe(true);
      expect(cliInterface.getCommandRegistry().hasCommand('/reset')).toBe(true);
      expect(cliInterface.getCommandRegistry().hasCommand('/history')).toBe(true);
    });

    it('should remove command', () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          console.log('Test command executed');
        }
      };

      cliInterface.addCommand(command);
      expect(cliInterface.getCommandRegistry().hasCommand('/test')).toBe(true);

      cliInterface.removeCommand('/test');
      expect(cliInterface.getCommandRegistry().hasCommand('/test')).toBe(false);
    });
  });

  describe('Session Management', () => {
    it('should check if running initially', () => {
      expect(cliInterface.isRunning()).toBe(false);
    });

    it('should stop the interface', () => {
      cliInterface.stop();
      expect(cliInterface.isRunning()).toBe(false);
    });
  });

  describe('Command Registry Integration', () => {
    it('should execute registered commands', async () => {
      let commandExecuted = false;
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          commandExecuted = true;
        }
      };

      cliInterface.addCommand(command);
      
      // Test the command execution through the registry
      const registry = cliInterface.getCommandRegistry();
      const result = await registry.executeCommand('/test', testInteraction);
      
      expect(result).toBe(true);
      expect(commandExecuted).toBe(true);
    });

    it('should handle non-existent commands', async () => {
      const registry = cliInterface.getCommandRegistry();
      const result = await registry.executeCommand('/nonexistent', testInteraction);
      
      expect(result).toBe(false);
    });

    it('should provide help text for registered commands', () => {
      cliInterface.addCommands(getChatCommands());
      
      const registry = cliInterface.getCommandRegistry();
      const helpText = registry.getHelpText();
      
      expect(helpText).toContain('Available commands:');
      expect(helpText).toContain('/?');
      expect(helpText).toContain('/reset');
      expect(helpText).toContain('/history');
    });
  });

  describe('Command Execution with Arguments', () => {
    it('should execute commands with arguments', async () => {
      let receivedArgs: string[] | undefined;
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async (interaction, args) => {
          receivedArgs = args;
        }
      };

      cliInterface.addCommand(command);
      
      const registry = cliInterface.getCommandRegistry();
      const args = ['arg1', 'arg2'];
      const result = await registry.executeCommand('/test', testInteraction, args);
      
      expect(result).toBe(true);
      expect(receivedArgs).toEqual(args);
    });
  });

  describe('Error Handling', () => {
    it('should handle command execution errors gracefully', async () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          throw new Error('Command failed');
        }
      };

      cliInterface.addCommand(command);
      
      const registry = cliInterface.getCommandRegistry();
      const result = await registry.executeCommand('/test', testInteraction);
      
      // Should still return true even if command fails
      expect(result).toBe(true);
    });
  });

  describe('Command Management', () => {
    it('should clear all commands', () => {
      cliInterface.addCommands(getChatCommands());
      expect(cliInterface.getCommandRegistry().getCommandCount()).toBeGreaterThan(0);
      
      cliInterface.getCommandRegistry().clear();
      expect(cliInterface.getCommandRegistry().getCommandCount()).toBe(0);
    });

    it('should get all registered commands', () => {
      const commands = getChatCommands();
      cliInterface.addCommands(commands);
      
      const allCommands = cliInterface.getCommandRegistry().getAllCommands();
      expect(allCommands).toHaveLength(commands.length);
      expect(allCommands).toEqual(expect.arrayContaining(commands));
    });
  });

  describe('Default Commands Integration', () => {
    it('should work with chat commands', () => {
      const chatCommands = getChatCommands();
      cliInterface.addCommands(chatCommands);
      
      const registry = cliInterface.getCommandRegistry();
      expect(registry.hasCommand('/?')).toBe(true);
      expect(registry.hasCommand('/reset')).toBe(true);
      expect(registry.hasCommand('/history')).toBe(true);
      expect(registry.hasCommand('/mem')).toBe(true);
      expect(registry.hasCommand('/exit')).toBe(true);
    });

    it('should execute reset command', async () => {
      cliInterface.addCommands(getChatCommands());
      
      // Add some messages
      testInteraction.addMessage({ role: 'user', content: 'Hello' });
      testInteraction.addMessage({ role: 'assistant', content: 'Hi!' });
      expect(testInteraction.getMessages()).toHaveLength(3);
      
      // Execute reset command
      const registry = cliInterface.getCommandRegistry();
      await registry.executeCommand('/reset', testInteraction);
      
      // After reset, should have fewer messages (context cleared)
      const messages = testInteraction.getMessages();
      expect(messages.length).toBeLessThan(3);
    });

    it('should execute history command', async () => {
      cliInterface.addCommands(getChatCommands());
      
      // Add some messages
      testInteraction.addMessage({ role: 'user', content: 'Hello' });
      testInteraction.addMessage({ role: 'assistant', content: 'Hi!' });
      
      // Capture console output
      const originalLog = console.log;
      const logOutput: string[] = [];
      console.log = (...args: any[]) => {
        logOutput.push(args.join(' '));
      };
      
      // Execute history command
      const registry = cliInterface.getCommandRegistry();
      await registry.executeCommand('/history', testInteraction);
      
      expect(logOutput).toContain('Conversation history:');
      expect(logOutput).toContain('user: Hello');
      expect(logOutput).toContain('assistant: Hi!');
      
      // Restore console.log
      console.log = originalLog;
    });
  });
});