import { describe, it, expect } from 'vitest';
import { 
  ToolUsageStimulus, 
  WeatherToolStimulus, 
  CalculatorToolStimulus, 
  FileAnalysisToolStimulus, 
  MultiToolUsageStimulus 
} from './tools.js';

describe('Tools Stimuli', () => {
  describe('ToolUsageStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ToolUsageStimulus.id).toBe('tool-usage');
      expect(ToolUsageStimulus.name).toBe('Tool Usage');
      expect(ToolUsageStimulus.description).toContain('use tools effectively');
    });

    it('should have correct role and objective', () => {
      expect(ToolUsageStimulus.role).toBe('AI assistant with access to tools');
      expect(ToolUsageStimulus.objective).toBe('use available tools effectively to provide accurate and helpful responses');
    });

    it('should have tool usage specific instructions', () => {
      expect(ToolUsageStimulus.instructions.some(i => i.includes('Use appropriate tools when needed'))).toBe(true);
      expect(ToolUsageStimulus.instructions.some(i => i.includes('Handle tool parameters correctly'))).toBe(true);
      expect(ToolUsageStimulus.instructions.some(i => i.includes('Interpret tool results accurately'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(ToolUsageStimulus.temperature).toBe(0.3);
      expect(ToolUsageStimulus.maxTokens).toBe(1500);
      expect(ToolUsageStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('WeatherToolStimulus', () => {
    it('should have correct basic properties', () => {
      expect(WeatherToolStimulus.id).toBe('weather-tool-usage');
      expect(WeatherToolStimulus.name).toBe('Weather Tool Usage');
      expect(WeatherToolStimulus.description).toContain('use weather tools effectively');
    });

    it('should have correct role and objective', () => {
      expect(WeatherToolStimulus.role).toBe('AI assistant with weather tool access');
      expect(WeatherToolStimulus.objective).toBe('use weather tools to provide accurate weather information');
    });

    it('should have weather specific instructions', () => {
      expect(WeatherToolStimulus.instructions.some(i => i.includes('Use weather tools to get current weather data'))).toBe(true);
      expect(WeatherToolStimulus.instructions.some(i => i.includes('Handle location parameters correctly'))).toBe(true);
      expect(WeatherToolStimulus.instructions.some(i => i.includes('Interpret weather data accurately'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(WeatherToolStimulus.temperature).toBe(0.3);
      expect(WeatherToolStimulus.maxTokens).toBe(1000);
      expect(WeatherToolStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('CalculatorToolStimulus', () => {
    it('should have correct basic properties', () => {
      expect(CalculatorToolStimulus.id).toBe('calculator-tool-usage');
      expect(CalculatorToolStimulus.name).toBe('Calculator Tool Usage');
      expect(CalculatorToolStimulus.description).toContain('use calculator tools effectively');
    });

    it('should have correct role and objective', () => {
      expect(CalculatorToolStimulus.role).toBe('AI assistant with calculator tool access');
      expect(CalculatorToolStimulus.objective).toBe('use calculator tools to solve mathematical problems');
    });

    it('should have calculator specific instructions', () => {
      expect(CalculatorToolStimulus.instructions.some(i => i.includes('Use calculator tools for mathematical calculations'))).toBe(true);
      expect(CalculatorToolStimulus.instructions.some(i => i.includes('Handle mathematical expressions correctly'))).toBe(true);
      expect(CalculatorToolStimulus.instructions.some(i => i.includes('Interpret calculation results accurately'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(CalculatorToolStimulus.temperature).toBe(0.2);
      expect(CalculatorToolStimulus.maxTokens).toBe(1000);
      expect(CalculatorToolStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('FileAnalysisToolStimulus', () => {
    it('should have correct basic properties', () => {
      expect(FileAnalysisToolStimulus.id).toBe('file-analysis-tool-usage');
      expect(FileAnalysisToolStimulus.name).toBe('File Analysis Tool Usage');
      expect(FileAnalysisToolStimulus.description).toContain('use file analysis tools effectively');
    });

    it('should have correct role and objective', () => {
      expect(FileAnalysisToolStimulus.role).toBe('AI assistant with file analysis tool access');
      expect(FileAnalysisToolStimulus.objective).toBe('use file analysis tools to provide file information');
    });

    it('should have file analysis specific instructions', () => {
      expect(FileAnalysisToolStimulus.instructions.some(i => i.includes('Use file analysis tools to examine files'))).toBe(true);
      expect(FileAnalysisToolStimulus.instructions.some(i => i.includes('Handle file path parameters correctly'))).toBe(true);
      expect(FileAnalysisToolStimulus.instructions.some(i => i.includes('Interpret file analysis results accurately'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(FileAnalysisToolStimulus.temperature).toBe(0.3);
      expect(FileAnalysisToolStimulus.maxTokens).toBe(1000);
      expect(FileAnalysisToolStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('MultiToolUsageStimulus', () => {
    it('should have correct basic properties', () => {
      expect(MultiToolUsageStimulus.id).toBe('multi-tool-usage');
      expect(MultiToolUsageStimulus.name).toBe('Multi-Tool Usage');
      expect(MultiToolUsageStimulus.description).toContain('use multiple tools effectively');
    });

    it('should have correct role and objective', () => {
      expect(MultiToolUsageStimulus.role).toBe('AI assistant with access to multiple tools');
      expect(MultiToolUsageStimulus.objective).toBe('use multiple tools effectively to solve complex problems');
    });

    it('should have multi-tool specific instructions', () => {
      expect(MultiToolUsageStimulus.instructions.some(i => i.includes('Use multiple tools in sequence when needed'))).toBe(true);
      expect(MultiToolUsageStimulus.instructions.some(i => i.includes('Handle tool dependencies and data flow correctly'))).toBe(true);
      expect(MultiToolUsageStimulus.instructions.some(i => i.includes('Integrate results from multiple tools'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(MultiToolUsageStimulus.temperature).toBe(0.3);
      expect(MultiToolUsageStimulus.maxTokens).toBe(2000);
      expect(MultiToolUsageStimulus.getRunnerType()).toBe('base');
    });
  });
});
