import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry, CLICommand } from './CommandRegistry.js';
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

describe('CommandRegistry', () => {
  let registry: CommandRegistry;
  let testInteraction: Interaction;

  beforeEach(() => {
    registry = new CommandRegistry();
    testInteraction = createTestInteraction();
  });

  describe('Command Registration', () => {
    it('should add a single command', () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          console.log('Test command executed');
        }
      };

      registry.addCommand(command);
      expect(registry.hasCommand('/test')).toBe(true);
      expect(registry.getCommandCount()).toBe(1);
    });

    it('should add multiple commands at once', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/test1',
          description: 'Test command 1',
          execute: async () => {
            console.log('Test command 1 executed');
          }
        },
        {
          trigger: '/test2',
          description: 'Test command 2',
          execute: async () => {
            console.log('Test command 2 executed');
          }
        }
      ];

      registry.addCommands(commands);
      expect(registry.hasCommand('/test1')).toBe(true);
      expect(registry.hasCommand('/test2')).toBe(true);
      expect(registry.getCommandCount()).toBe(2);
    });

    it('should remove a command', () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          console.log('Test command executed');
        }
      };

      registry.addCommand(command);
      expect(registry.hasCommand('/test')).toBe(true);

      registry.removeCommand('/test');
      expect(registry.hasCommand('/test')).toBe(false);
      expect(registry.getCommandCount()).toBe(0);
    });

    it('should clear all commands', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/test1',
          description: 'Test command 1',
          execute: async () => {
            console.log('Test command 1 executed');
          }
        },
        {
          trigger: '/test2',
          description: 'Test command 2',
          execute: async () => {
            console.log('Test command 2 executed');
          }
        }
      ];

      registry.addCommands(commands);
      expect(registry.getCommandCount()).toBe(2);

      registry.clear();
      expect(registry.getCommandCount()).toBe(0);
    });
  });

  describe('Command Execution', () => {
    it('should execute a command successfully', async () => {
      let executed = false;
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          executed = true;
        }
      };

      registry.addCommand(command);
      const result = await registry.executeCommand('/test', testInteraction);

      expect(result).toBe(true);
      expect(executed).toBe(true);
    });

    it('should execute a command with arguments', async () => {
      let receivedArgs: string[] | undefined;
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async (interaction, args) => {
          receivedArgs = args;
        }
      };

      registry.addCommand(command);
      const args = ['arg1', 'arg2'];
      const result = await registry.executeCommand('/test', testInteraction, args);

      expect(result).toBe(true);
      expect(receivedArgs).toEqual(args);
    });

    it('should return false for non-existent command', async () => {
      const result = await registry.executeCommand('/nonexistent', testInteraction);
      expect(result).toBe(false);
    });

    it('should handle command execution errors gracefully', async () => {
      const command: CLICommand = {
        trigger: '/test',
        description: 'Test command',
        execute: async () => {
          throw new Error('Command failed');
        }
      };

      registry.addCommand(command);
      const result = await registry.executeCommand('/test', testInteraction);

      expect(result).toBe(true); // Should still return true even if command fails
    });
  });

  describe('Help System', () => {
    it('should generate help text for registered commands', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/help',
          description: 'Show help',
          execute: async () => {}
        },
        {
          trigger: '/test',
          description: 'Test command',
          execute: async () => {}
        }
      ];

      registry.addCommands(commands);
      const helpText = registry.getHelpText();

      expect(helpText).toContain('Available commands:');
      expect(helpText).toContain('/help');
      expect(helpText).toContain('/test');
      expect(helpText).toContain('Show help');
      expect(helpText).toContain('Test command');
    });

    it('should sort commands alphabetically', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/zebra',
          description: 'Zebra command',
          execute: async () => {}
        },
        {
          trigger: '/apple',
          description: 'Apple command',
          execute: async () => {}
        }
      ];

      registry.addCommands(commands);
      const helpText = registry.getHelpText();

      const appleIndex = helpText.indexOf('/apple');
      const zebraIndex = helpText.indexOf('/zebra');
      expect(appleIndex).toBeLessThan(zebraIndex);
    });

    it('should handle empty registry', () => {
      const helpText = registry.getHelpText();
      expect(helpText).toBe('No commands available.');
    });

    it('should only include commands with descriptions in help', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/help',
          description: 'Show help',
          execute: async () => {}
        },
        {
          trigger: '/test',
          description: '',
          execute: async () => {}
        },
        {
          trigger: '/hidden',
          description: 'Hidden command',
          execute: async () => {}
        }
      ];

      registry.addCommands(commands);
      const helpText = registry.getHelpText();

      expect(helpText).toContain('/help');
      expect(helpText).toContain('/hidden');
      expect(helpText).not.toContain('/test');
    });
  });

  describe('Command Retrieval', () => {
    it('should get all registered commands', () => {
      const commands: CLICommand[] = [
        {
          trigger: '/test1',
          description: 'Test command 1',
          execute: async () => {}
        },
        {
          trigger: '/test2',
          description: 'Test command 2',
          execute: async () => {}
        }
      ];

      registry.addCommands(commands);
      const allCommands = registry.getAllCommands();

      expect(allCommands).toHaveLength(2);
      expect(allCommands).toEqual(expect.arrayContaining(commands));
    });

    it('should return empty array when no commands registered', () => {
      const allCommands = registry.getAllCommands();
      expect(allCommands).toEqual([]);
    });
  });
});