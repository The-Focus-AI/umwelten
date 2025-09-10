import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { 
  calculatorTool, 
  randomNumberTool, 
  statisticsTool,
} from '../stimulus/tools/index.js';

// Import the actual implementations
import { addToolsCommand, runToolsDemo } from './tools.js';

describe('CLI Tools Command', () => {
  let program: Command;
  let consoleSpy: any;
  let processExitSpy: any;

  beforeEach(async () => {
    // Create a new program instance
    program = new Command();
    
    // Mock console methods to capture output
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      dir: vi.spyOn(console, 'dir').mockImplementation(() => {})
    };
    
    // Mock process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tools list command', () => {
    it('should list all available tools', async () => {
      addToolsCommand(program);
      await program.parseAsync(['node', 'cli', 'tools', 'list']);
      
      // Verify output structure
      expect(consoleSpy.log).toHaveBeenCalledWith('\n🔧 Available Tools:');
      expect(consoleSpy.log).toHaveBeenCalledWith('==================');
      
      // Check that tool information is displayed
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      expect(logCalls).toContain('calculator');
      expect(logCalls).toContain('randomNumber');
      expect(logCalls).toContain('statistics');
      
      // Verify specific tool descriptions are present
      expect(logCalls).toContain('Performs basic arithmetic operations');
      expect(logCalls).toContain('Generates a random number within a specified range');
      expect(logCalls).toContain('Calculates basic statistics');
      
      // Verify total count
      expect(logCalls).toContain('Total: 3 tools available');
      
      // Verify we captured the expected number of log calls
      expect(consoleSpy.log.mock.calls.length).toBeGreaterThan(0);
    });

    it('should show correct tool metadata', async () => {
      addToolsCommand(program);
      await program.parseAsync(['node', 'cli', 'tools', 'list']);
      
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      
      // Check calculator tool metadata
      expect(logCalls).toContain('calculator');
      expect(logCalls).toContain('Performs basic arithmetic operations');
      
      // Check statistics tool metadata
      expect(logCalls).toContain('statistics');
      expect(logCalls).toContain('Calculates basic statistics');
      
      // Check random number tool metadata
      expect(logCalls).toContain('randomNumber');
      expect(logCalls).toContain('Generates a random number');
    });

    it('should show total count of tools', async () => {
      addToolsCommand(program);
      await program.parseAsync(['node', 'cli', 'tools', 'list']);
      
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Total: 3 tools available');
    });

    it('should produce the exact expected output structure', async () => {
      addToolsCommand(program);
      await program.parseAsync(['node', 'cli', 'tools', 'list']);
      
      // Get all the log calls as individual strings
      const allLogCalls = consoleSpy.log.mock.calls.map(call => call[0]);
      
      // Verify the exact structure of the output
      expect(allLogCalls).toContain('\n🔧 Available Tools:');
      expect(allLogCalls).toContain('==================');
      expect(allLogCalls).toContain('\n📋 calculator');
      expect(allLogCalls).toContain('   Description: Performs basic arithmetic operations (add, subtract, multiply, divide)');
      expect(allLogCalls).toContain('\n📋 randomNumber');
      expect(allLogCalls).toContain('   Description: Generates a random number within a specified range');
      expect(allLogCalls).toContain('\n📋 statistics');
      expect(allLogCalls).toContain('   Description: Calculates basic statistics (mean, median, mode, standard deviation) for a list of numbers');
      expect(allLogCalls).toContain('\nTotal: 3 tools available\n');
      
      // Verify we have the right number of log calls (header + 3 tools + total)
      expect(allLogCalls.length).toBe(9);
    });
  });

  describe('tools demo command', () => {
    it('should handle missing provider and model gracefully', async () => {
      addToolsCommand(program);
      
      try {
        await program.parseAsync(['node','cli','tools','demo','--prompt','Test prompt','--max-steps','5']);
        
        expect(consoleSpy.error).toHaveBeenCalledWith('❌ Provider and model are required');
        expect(processExitSpy).toHaveBeenCalledWith(1);
        
      } catch (error) {
        // Expected to throw due to process.exit mock
        expect(error.message).toBe('process.exit called');
      }
    });

    it('should run demo with default prompt when API keys are available', async () => {
      // Skip if no API keys are available
      if (!process.env.OPENROUTER_API_KEY && !process.env.GOOGLE_API_KEY) {
        console.log('⚠️ No API keys available, skipping integration test');
        return;
      }

      addToolsCommand(program);
      
      try {
        // Use available provider
        const provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'google';
        const model = process.env.OPENROUTER_API_KEY ? 'gpt-4' : 'gemini-2.5-pro';
        
        await runToolsDemo({
          prompt: 'Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]',
          maxSteps: '5',
          provider,
          model
        });
        
        // Verify basic output appeared
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('🚀 Starting tools demonstration');
        
        // Check that tools are mentioned
        expect(logCalls).toContain('calculator');
        expect(logCalls).toContain('randomNumber');
        expect(logCalls).toContain('statistics');
        
      } catch (error) {
        // If it's a network/API error, that's expected in test environment
        if (error.message.includes('API') || error.message.includes('network') || error.message.includes('timeout')) {
          console.log('⚠️ API/Network error in test environment, skipping');
          return;
        }
        throw error;
      }
    });

    it('should run demo with custom prompt when API keys are available', async () => {
      // Skip if no API keys are available
      if (!process.env.OPENROUTER_API_KEY && !process.env.GOOGLE_API_KEY) {
        console.log('⚠️ No API keys available, skipping integration test');
        return;
      }

      addToolsCommand(program);
      
      try {
        const customPrompt = 'Calculate 100 * 5 using the calculator tool';
        const provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'google';
        const model = process.env.OPENROUTER_API_KEY ? 'gpt-4' : 'gemini-2.5-pro';
        
        await runToolsDemo({
          prompt: customPrompt,
          maxSteps: '3',
          provider,
          model
        });
        
        // Verify the demo ran
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('🚀 Starting tools demonstration');
        
      } catch (error) {
        // If it's a network/API error, that's expected in test environment
        if (error.message.includes('API') || error.message.includes('network') || error.message.includes('timeout')) {
          console.log('⚠️ API/Network error in test environment, skipping');
          return;
        }
        throw error;
      }
    });

    it('should run demo with Ollama when available', async () => {
      // Skip if Ollama is not available
      if (!process.env.OLLAMA_BASE_URL) {
        console.log('⚠️ Ollama not available, skipping integration test');
        return;
      }

      addToolsCommand(program);
      
      try {
        await runToolsDemo({
          prompt: 'Calculate 25 + 15 using the calculator tool',
          maxSteps: '3',
          provider: 'ollama',
          model: 'qwen3:latest'
        });
        
        // Verify the demo ran
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('🚀 Starting tools demonstration');
        
        // Check that tools are mentioned
        expect(logCalls).toContain('calculator');
        expect(logCalls).toContain('randomNumber');
        expect(logCalls).toContain('statistics');
        
      } catch (error) {
        // If it's a network/API error, that's expected in test environment
        if (error.message.includes('API') || error.message.includes('network') || error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
          console.log('⚠️ Ollama connection error in test environment, skipping');
          return;
        }
        throw error;
      }
    });

    it('should display execution summary with metrics when demo runs', async () => {
      // Skip if no API keys are available
      if (!process.env.OPENROUTER_API_KEY && !process.env.GOOGLE_API_KEY) {
        console.log('⚠️ No API keys available, skipping integration test');
        return;
      }

      addToolsCommand(program);
      
      try {
        const provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'google';
        const model = process.env.OPENROUTER_API_KEY ? 'gpt-4' : 'gemini-2.5-pro';
        
        await runToolsDemo({ 
          prompt: 'Test prompt', 
          maxSteps: '5', 
          provider, 
          model 
        });
        
        // Verify execution summary appears
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('📊 Execution Summary:');
        expect(logCalls).toContain('✅ Response generated successfully');
        
      } catch (error) {
        // If it's a network/API error, that's expected in test environment
        if (error.message.includes('API') || error.message.includes('network') || error.message.includes('timeout')) {
          console.log('⚠️ API/Network error in test environment, skipping');
          return;
        }
        throw error;
      }
    });

    it('should handle errors during demo execution', async () => {
      addToolsCommand(program);
      
      try {
        // Try with invalid provider/model combination
        await runToolsDemo({ 
          prompt: 'Test prompt', 
          maxSteps: '5', 
          provider: 'invalid-provider', 
          model: 'invalid-model' 
        });
        
        // Should show error message
        expect(consoleSpy.error).toHaveBeenCalledWith('❌ Error during tools demo:', expect.any(Error));
        
      } catch (error) {
        // Expected to throw due to invalid provider
        expect(error.message).toContain('process.exit called');
      }
    });
  });

  describe('tools command structure', () => {
    it('should have correct command hierarchy', () => {
      const toolsCommand = addToolsCommand(program);
      
      expect(toolsCommand.name()).toBe('tools');
      expect(toolsCommand.description()).toBe('Demonstrate tool calling capabilities');
      
      const subcommands = toolsCommand.commands.map(cmd => cmd.name());
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('demo');
    });

    it('should expose built-in tools via list output', async () => {
      addToolsCommand(program);
      await program.parseAsync(['node','cli','tools','list']);
      const log = consoleSpy.log.mock.calls.flat().join(' ');
      expect(log).toContain('calculator');
      expect(log).toContain('randomNumber');
      expect(log).toContain('statistics');
    });

    it('should have proper command options', () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      expect(demoCommand).toBeDefined();
      
      const options = demoCommand?.options || [];
      const optionNames = options.map(opt => opt.long);
      
      expect(optionNames).toContain('--prompt');
      expect(optionNames).toContain('--max-steps');
      expect(optionNames).toContain('--provider');
      expect(optionNames).toContain('--model');
      // no --json option on demo
    });
  });

  describe('debug mode', () => {
    it('should show debug information when DEBUG=1', async () => {
      addToolsCommand(program);
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { 
        ...originalEnv, 
        OPENROUTER_API_KEY: 'test-key',
        DEBUG: '1'
      };
      
      try {
        await program.parseAsync(['node','cli','tools','demo','--prompt','Test prompt','--max-steps','5','--provider','openrouter','--model','gpt-4']);
        
        // Check for debug output
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('[DEBUG]');
        
      } finally {
        process.env = originalEnv;
      }
    });
  });
});