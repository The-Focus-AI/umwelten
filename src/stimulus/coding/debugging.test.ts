import { describe, it, expect } from 'vitest';
import { 
  CodeDebuggingStimulus, 
  PerformanceDebuggingStimulus, 
  MemoryLeakDebuggingStimulus, 
  ConcurrencyDebuggingStimulus, 
  SecurityDebuggingStimulus 
} from './debugging.js';

describe('Debugging Stimuli', () => {
  describe('CodeDebuggingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(CodeDebuggingStimulus.id).toBe('code-debugging');
      expect(CodeDebuggingStimulus.name).toBe('Code Debugging');
      expect(CodeDebuggingStimulus.description).toContain('debug and fix code issues');
    });

    it('should have correct role and objective', () => {
      expect(CodeDebuggingStimulus.role).toBe('senior software engineer and debugging expert');
      expect(CodeDebuggingStimulus.objective).toBe('identify and fix bugs in code');
    });

    it('should have debugging specific instructions', () => {
      expect(CodeDebuggingStimulus.instructions.some(i => i.includes('identify bugs'))).toBe(true);
      expect(CodeDebuggingStimulus.instructions.some(i => i.includes('root cause'))).toBe(true);
      expect(CodeDebuggingStimulus.instructions.some(i => i.includes('corrected code'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(CodeDebuggingStimulus.temperature).toBe(0.2);
      expect(CodeDebuggingStimulus.maxTokens).toBe(1500);
      expect(CodeDebuggingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PerformanceDebuggingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PerformanceDebuggingStimulus.id).toBe('performance-debugging');
      expect(PerformanceDebuggingStimulus.name).toBe('Performance Debugging');
      expect(PerformanceDebuggingStimulus.description).toContain('performance issues');
    });

    it('should have correct role and objective', () => {
      expect(PerformanceDebuggingStimulus.role).toBe('performance engineer and optimization expert');
      expect(PerformanceDebuggingStimulus.objective).toBe('identify and fix performance bottlenecks in code');
    });

    it('should have performance specific instructions', () => {
      expect(PerformanceDebuggingStimulus.instructions.some(i => i.includes('performance issues'))).toBe(true);
      expect(PerformanceDebuggingStimulus.instructions.some(i => i.includes('bottlenecks and inefficiencies'))).toBe(true);
      expect(PerformanceDebuggingStimulus.instructions.some(i => i.includes('optimized solutions'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PerformanceDebuggingStimulus.temperature).toBe(0.2);
      expect(PerformanceDebuggingStimulus.maxTokens).toBe(1500);
      expect(PerformanceDebuggingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('MemoryLeakDebuggingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(MemoryLeakDebuggingStimulus.id).toBe('memory-leak-debugging');
      expect(MemoryLeakDebuggingStimulus.name).toBe('Memory Leak Debugging');
      expect(MemoryLeakDebuggingStimulus.description).toContain('memory leaks');
    });

    it('should have correct role and objective', () => {
      expect(MemoryLeakDebuggingStimulus.role).toBe('systems engineer and memory management expert');
      expect(MemoryLeakDebuggingStimulus.objective).toBe('identify and fix memory leaks in code');
    });

    it('should have memory management specific instructions', () => {
      expect(MemoryLeakDebuggingStimulus.instructions.some(i => i.includes('memory leak patterns'))).toBe(true);
      expect(MemoryLeakDebuggingStimulus.instructions.some(i => i.includes('resource management issues'))).toBe(true);
      expect(MemoryLeakDebuggingStimulus.instructions.some(i => i.includes('proper cleanup'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(MemoryLeakDebuggingStimulus.temperature).toBe(0.2);
      expect(MemoryLeakDebuggingStimulus.maxTokens).toBe(1500);
      expect(MemoryLeakDebuggingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('ConcurrencyDebuggingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ConcurrencyDebuggingStimulus.id).toBe('concurrency-debugging');
      expect(ConcurrencyDebuggingStimulus.name).toBe('Concurrency Debugging');
      expect(ConcurrencyDebuggingStimulus.description).toContain('concurrency and threading issues');
    });

    it('should have correct role and objective', () => {
      expect(ConcurrencyDebuggingStimulus.role).toBe('concurrency expert and systems programmer');
      expect(ConcurrencyDebuggingStimulus.objective).toBe('identify and fix concurrency-related bugs');
    });

    it('should have concurrency specific instructions', () => {
      expect(ConcurrencyDebuggingStimulus.instructions.some(i => i.includes('race conditions and deadlocks'))).toBe(true);
      expect(ConcurrencyDebuggingStimulus.instructions.some(i => i.includes('synchronization issues'))).toBe(true);
      expect(ConcurrencyDebuggingStimulus.instructions.some(i => i.includes('thread-safe solutions'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(ConcurrencyDebuggingStimulus.temperature).toBe(0.2);
      expect(ConcurrencyDebuggingStimulus.maxTokens).toBe(1500);
      expect(ConcurrencyDebuggingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('SecurityDebuggingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(SecurityDebuggingStimulus.id).toBe('security-debugging');
      expect(SecurityDebuggingStimulus.name).toBe('Security Vulnerability Debugging');
      expect(SecurityDebuggingStimulus.description).toContain('security vulnerabilities');
    });

    it('should have correct role and objective', () => {
      expect(SecurityDebuggingStimulus.role).toBe('security engineer and penetration tester');
      expect(SecurityDebuggingStimulus.objective).toBe('identify and fix security vulnerabilities in code');
    });

    it('should have security specific instructions', () => {
      expect(SecurityDebuggingStimulus.instructions.some(i => i.includes('security vulnerabilities'))).toBe(true);
      expect(SecurityDebuggingStimulus.instructions.some(i => i.includes('SQL injection, XSS'))).toBe(true);
      expect(SecurityDebuggingStimulus.instructions.some(i => i.includes('secure code solutions'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(SecurityDebuggingStimulus.temperature).toBe(0.2);
      expect(SecurityDebuggingStimulus.maxTokens).toBe(1500);
      expect(SecurityDebuggingStimulus.getRunnerType()).toBe('base');
    });
  });
});
