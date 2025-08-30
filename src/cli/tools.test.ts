import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { addToolsCommand } from './tools.js';
import { 
  calculatorTool, 
  randomNumberTool, 
  statisticsTool,
  registerTool,
  listTools
} from '../stimulus/tools/index.js';

// Mock the providers and runners
vi.mock('../providers/index.js', () => ({
  getModel: vi.fn().mockResolvedValue({
    generateText: vi.fn().mockResolvedValue({
      text: 'Mock response with tool calls',
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: 'stop'
    })
  })
}));

vi.mock('../cognition/runner.js', () => ({
  BaseModelRunner: vi.fn().mockImplementation(() => ({
    streamText: vi.fn().mockResolvedValue({
      content: 'Mock response with tool calls',
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        tokenUsage: { promptTokens: 100, completionTokens: 50, total: 150 },
        cost: { totalCost: 0.0001, promptTokens: 0.00005, completionTokens: 0.00005 },
        toolCalls: [{ name: 'calculator', args: { operation: 'add', a: 15, b: 27 } }]
      }
    })
  }))
}));

vi.mock('../interaction/interaction.js', () => ({
  Interaction: vi.fn().mockImplementation(() => ({
    setTools: vi.fn(),
    setMaxSteps: vi.fn(),
    addMessage: vi.fn()
  }))
}));

describe('CLI Tools Command', () => {
  let program: Command;
  let consoleSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Create a new program instance
    program = new Command();
    
    // Mock console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {})
    };
    
    // Mock process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Register tools for testing
    registerTool(calculatorTool);
    registerTool(randomNumberTool);
    registerTool(statisticsTool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tools list command', () => {
    it('should list all available tools', async () => {
      const toolsCommand = addToolsCommand(program);
      const listCommand = toolsCommand.commands.find(cmd => cmd.name() === 'list');
      
      expect(listCommand).toBeDefined();
      
      // Execute the list command by calling its action directly
      if (listCommand?.action) {
        await listCommand.action();
      }
      
      // Verify output
      expect(consoleSpy.log).toHaveBeenCalledWith('\n🔧 Available Tools:');
      expect(consoleSpy.log).toHaveBeenCalledWith('==================');
      
      // Check that tool information is displayed
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      expect(logCalls).toContain('calculator');
      expect(logCalls).toContain('randomNumber');
      expect(logCalls).toContain('statistics');
      expect(logCalls).toContain('math');
      expect(logCalls).toContain('arithmetic');
      expect(logCalls).toContain('statistics');
    });

    it('should show correct tool metadata', async () => {
      const toolsCommand = addToolsCommand(program);
      const listCommand = toolsCommand.commands.find(cmd => cmd.name() === 'list');
      
      if (listCommand?.action) {
        await listCommand.action();
      }
      
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      
      // Check calculator tool metadata
      expect(logCalls).toContain('calculator');
      expect(logCalls).toContain('Performs basic arithmetic operations');
      expect(logCalls).toContain('math');
      expect(logCalls).toContain('arithmetic');
      
      // Check statistics tool metadata
      expect(logCalls).toContain('statistics');
      expect(logCalls).toContain('Calculates basic statistics');
      expect(logCalls).toContain('data');
      
      // Check random number tool metadata
      expect(logCalls).toContain('randomNumber');
      expect(logCalls).toContain('Generates a random number');
      expect(logCalls).toContain('random');
    });

    it('should show total count of tools', async () => {
      const toolsCommand = addToolsCommand(program);
      const listCommand = toolsCommand.commands.find(cmd => cmd.name() === 'list');
      
      if (listCommand?.action) {
        await listCommand.action();
      }
      
      const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Total: 3 tools available');
    });
  });

  describe('tools demo command', () => {
    it('should run demo with default prompt', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      expect(demoCommand).toBeDefined();
      
      // Mock environment variables for provider and model
      const originalEnv = process.env;
      process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
      
      try {
        // Execute the demo command with default options
        if (demoCommand?.action) {
          await demoCommand.action({
            prompt: 'Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]',
            maxSteps: '5',
            provider: 'openrouter',
            model: 'gpt-4'
          });
        }
        
        // Verify output
        expect(consoleSpy.log).toHaveBeenCalledWith('🚀 Starting tools demonstration...\n');
        expect(consoleSpy.log).toHaveBeenCalledWith('📝 User prompt:');
        expect(consoleSpy.log).toHaveBeenCalledWith('🔧 Available tools:');
        expect(consoleSpy.log).toHaveBeenCalledWith('🔄 Max steps: 5');
        expect(consoleSpy.log).toHaveBeenCalledWith('\n🤖 AI Response:\n');
        
        // Check that tools are mentioned
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('calculator');
        expect(logCalls).toContain('randomNumber');
        expect(logCalls).toContain('statistics');
        
      } finally {
        process.env = originalEnv;
      }
    });

    it('should run demo with custom prompt', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
      
      try {
        const customPrompt = 'Calculate 100 * 5 using the calculator tool';
        
        if (demoCommand?.action) {
          await demoCommand.action({
            prompt: customPrompt,
            maxSteps: '3',
            provider: 'openrouter',
            model: 'gpt-4'
          });
        }
        
        // Verify custom prompt is used
        expect(consoleSpy.log).toHaveBeenCalledWith('📝 User prompt:', customPrompt);
        expect(consoleSpy.log).toHaveBeenCalledWith('🔄 Max steps: 3');
        
      } finally {
        process.env = originalEnv;
      }
    });

    it('should run demo with qwen3:latest model', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { ...originalEnv, OLLAMA_BASE_URL: 'http://localhost:11434' };
      
      try {
        if (demoCommand?.action) {
          await demoCommand.action({
            prompt: 'Calculate 25 + 15 using the calculator tool',
            maxSteps: '3',
            provider: 'ollama',
            model: 'qwen3:latest'
          });
        }
        
        // Verify qwen3:latest is used
        expect(consoleSpy.log).toHaveBeenCalledWith('📝 User prompt:', 'Calculate 25 + 15 using the calculator tool');
        expect(consoleSpy.log).toHaveBeenCalledWith('🔄 Max steps: 3');
        
        // Check that tools are mentioned
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('calculator');
        expect(logCalls).toContain('randomNumber');
        expect(logCalls).toContain('statistics');
        
      } finally {
        process.env = originalEnv;
      }
    });

    it('should handle missing provider and model gracefully', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      try {
        await demoCommand?.action({
          prompt: 'Test prompt',
          maxSteps: '5'
          // No provider or model specified
        });
        
        expect(consoleSpy.error).toHaveBeenCalledWith('❌ Provider and model are required');
        expect(processExitSpy).toHaveBeenCalledWith(1);
        
      } catch (error) {
        // Expected to throw due to process.exit mock
        expect(error.message).toBe('process.exit called');
      }
    });

    it('should display execution summary with metrics', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
      
      try {
        await demoCommand?.action({
          prompt: 'Test prompt',
          maxSteps: '5',
          provider: 'openrouter',
          model: 'gpt-4'
        });
        
        // Check for execution summary
        expect(consoleSpy.log).toHaveBeenCalledWith('\n\n📊 Execution Summary:');
        expect(consoleSpy.log).toHaveBeenCalledWith('=====================');
        expect(consoleSpy.log).toHaveBeenCalledWith('✅ Response generated successfully');
        
        // Check for cost and token information
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('💰 Cost:');
        expect(logCalls).toContain('🎯 Tokens:');
        expect(logCalls).toContain('⏱️  Duration:');
        
      } finally {
        process.env = originalEnv;
      }
    });

    it('should handle errors during demo execution', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      // Mock getModel to throw an error
      const { getModel } = await import('../providers/index.js');
      vi.mocked(getModel).mockRejectedValue(new Error('Provider error'));
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
      
      try {
        await demoCommand?.action({
          prompt: 'Test prompt',
          maxSteps: '5',
          provider: 'openrouter',
          model: 'gpt-4'
        });
        
        expect(consoleSpy.error).toHaveBeenCalledWith('❌ Error during tools demo:', expect.any(Error));
        
      } finally {
        process.env = originalEnv;
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

    it('should register tools correctly', () => {
      // Clear any previously registered tools
      const tools = listTools();
      expect(tools.length).toBeGreaterThanOrEqual(3);
      
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toContain('calculator');
      expect(toolNames).toContain('randomNumber');
      expect(toolNames).toContain('statistics');
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
      expect(optionNames).toContain('--json');
    });
  });

  describe('debug mode', () => {
    it('should show debug information when DEBUG=1', async () => {
      const toolsCommand = addToolsCommand(program);
      const demoCommand = toolsCommand.commands.find(cmd => cmd.name() === 'demo');
      
      // Mock environment variables
      const originalEnv = process.env;
      process.env = { 
        ...originalEnv, 
        OPENROUTER_API_KEY: 'test-key',
        DEBUG: '1'
      };
      
      try {
        await demoCommand?.action({
          prompt: 'Test prompt',
          maxSteps: '5',
          provider: 'openrouter',
          model: 'gpt-4'
        });
        
        // Check for debug output
        const logCalls = consoleSpy.log.mock.calls.flat().join(' ');
        expect(logCalls).toContain('[DEBUG]');
        
      } finally {
        process.env = originalEnv;
      }
    });
  });
});
