import { describe, it, expect } from 'vitest';
import { 
  PythonStimulus, 
  PythonDataScienceStimulus, 
  PythonAPIStimulus, 
  PythonTestingStimulus 
} from './python.js';

describe('Python Stimuli', () => {
  describe('PythonStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PythonStimulus.id).toBe('python-basic');
      expect(PythonStimulus.name).toBe('Python Code Generation');
      expect(PythonStimulus.description).toContain('generate Python code');
    });

    it('should have correct role and objective', () => {
      expect(PythonStimulus.role).toBe('senior Python developer');
      expect(PythonStimulus.objective).toBe('write clean, well-structured Python code');
    });

    it('should have appropriate instructions', () => {
      expect(PythonStimulus.instructions.some(i => i.includes('PEP 8 style guidelines'))).toBe(true);
      expect(PythonStimulus.instructions.some(i => i.includes('type hints and docstrings'))).toBe(true);
      expect(PythonStimulus.instructions.some(i => i.includes('error handling where appropriate'))).toBe(true);
    });

    it('should have appropriate output requirements', () => {
      expect(PythonStimulus.output.some(o => o.includes('Complete Python code with proper structure'))).toBe(true);
      expect(PythonStimulus.output.some(o => o.includes('imports and main guard'))).toBe(true);
      expect(PythonStimulus.output.some(o => o.includes('docstrings for functions and classes'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PythonStimulus.temperature).toBe(0.3);
      expect(PythonStimulus.maxTokens).toBe(1000);
      expect(PythonStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PythonDataScienceStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PythonDataScienceStimulus.id).toBe('python-data-science');
      expect(PythonDataScienceStimulus.name).toBe('Python Data Science');
      expect(PythonDataScienceStimulus.description).toContain('data science code');
    });

    it('should have correct role and objective', () => {
      expect(PythonDataScienceStimulus.role).toBe('data scientist and Python expert');
      expect(PythonDataScienceStimulus.objective).toBe('create data science solutions using Python');
    });

    it('should have data science specific instructions', () => {
      expect(PythonDataScienceStimulus.instructions.some(i => i.includes('pandas, numpy, and matplotlib/seaborn'))).toBe(true);
      expect(PythonDataScienceStimulus.instructions.some(i => i.includes('data processing code'))).toBe(true);
      expect(PythonDataScienceStimulus.instructions.some(i => i.includes('data visualization'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PythonDataScienceStimulus.temperature).toBe(0.3);
      expect(PythonDataScienceStimulus.maxTokens).toBe(1500);
      expect(PythonDataScienceStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PythonAPIStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PythonAPIStimulus.id).toBe('python-api');
      expect(PythonAPIStimulus.name).toBe('Python API Development');
      expect(PythonAPIStimulus.description).toContain('create Python APIs');
    });

    it('should have correct role and objective', () => {
      expect(PythonAPIStimulus.role).toBe('Python developer specializing in API development');
      expect(PythonAPIStimulus.objective).toBe('create robust Python APIs using FastAPI or Flask');
    });

    it('should have API specific instructions', () => {
      expect(PythonAPIStimulus.instructions.some(i => i.includes('Python API with proper structure'))).toBe(true);
      expect(PythonAPIStimulus.instructions.some(i => i.includes('request/response validation'))).toBe(true);
      expect(PythonAPIStimulus.instructions.some(i => i.includes('error handling and logging'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PythonAPIStimulus.temperature).toBe(0.3);
      expect(PythonAPIStimulus.maxTokens).toBe(1500);
      expect(PythonAPIStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PythonTestingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PythonTestingStimulus.id).toBe('python-testing');
      expect(PythonTestingStimulus.name).toBe('Python Testing');
      expect(PythonTestingStimulus.description).toContain('write Python tests');
    });

    it('should have correct role and objective', () => {
      expect(PythonTestingStimulus.role).toBe('Python developer specializing in testing');
      expect(PythonTestingStimulus.objective).toBe('create comprehensive Python test suites');
    });

    it('should have testing specific instructions', () => {
      expect(PythonTestingStimulus.instructions.some(i => i.includes('pytest or unittest'))).toBe(true);
      expect(PythonTestingStimulus.instructions.some(i => i.includes('test fixtures and mocking where appropriate'))).toBe(true);
      expect(PythonTestingStimulus.instructions.some(i => i.includes('edge cases and error conditions'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PythonTestingStimulus.temperature).toBe(0.3);
      expect(PythonTestingStimulus.maxTokens).toBe(1000);
      expect(PythonTestingStimulus.getRunnerType()).toBe('base');
    });
  });
});
