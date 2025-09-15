import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Code Debugging Stimulus
 * 
 * Tests models' ability to debug and fix code issues.
 * This evaluates:
 * - Problem identification and analysis
 * - Debugging methodology
 * - Code fixing abilities
 * - Understanding of common programming errors
 */
export const CodeDebuggingStimulus = new Stimulus({
  id: 'code-debugging',
  name: 'Code Debugging',
  description: 'Test models\' ability to debug and fix code issues',
  
  role: "senior software engineer and debugging expert",
  objective: "identify and fix bugs in code",
  instructions: [
    "Analyze the provided code carefully to identify bugs",
    "Explain the root cause of each bug",
    "Provide corrected code with explanations",
    "Suggest improvements to prevent similar issues"
  ],
  output: [
    "Clear identification of all bugs found",
    "Explanation of root causes",
    "Corrected code with comments",
    "Suggestions for code improvements"
  ],
  examples: [
    "Example: Debug a Python function that's causing a TypeError and fix the issue"
  ],
  temperature: 0.2, // Very low temperature for precise debugging
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Performance Debugging Stimulus
 */
export const PerformanceDebuggingStimulus = new Stimulus({
  id: 'performance-debugging',
  name: 'Performance Debugging',
  description: 'Test models\' ability to identify and fix performance issues',
  
  role: "performance engineer and optimization expert",
  objective: "identify and fix performance bottlenecks in code",
  instructions: [
    "Analyze code for performance issues",
    "Identify bottlenecks and inefficiencies",
    "Provide optimized solutions",
    "Explain performance improvements"
  ],
  output: [
    "Identification of performance bottlenecks",
    "Analysis of time and space complexity",
    "Optimized code solutions",
    "Performance improvement explanations"
  ],
  examples: [
    "Example: Optimize a slow database query and explain the performance improvements"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Memory Leak Debugging Stimulus
 */
export const MemoryLeakDebuggingStimulus = new Stimulus({
  id: 'memory-leak-debugging',
  name: 'Memory Leak Debugging',
  description: 'Test models\' ability to identify and fix memory leaks',
  
  role: "systems engineer and memory management expert",
  objective: "identify and fix memory leaks in code",
  instructions: [
    "Analyze code for memory leak patterns",
    "Identify resource management issues",
    "Provide solutions for proper cleanup",
    "Suggest best practices for memory management"
  ],
  output: [
    "Identification of memory leak sources",
    "Explanation of leak mechanisms",
    "Corrected code with proper cleanup",
    "Memory management best practices"
  ],
  examples: [
    "Example: Fix a Node.js application with memory leaks in event listeners"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Concurrency Debugging Stimulus
 */
export const ConcurrencyDebuggingStimulus = new Stimulus({
  id: 'concurrency-debugging',
  name: 'Concurrency Debugging',
  description: 'Test models\' ability to debug concurrency and threading issues',
  
  role: "concurrency expert and systems programmer",
  objective: "identify and fix concurrency-related bugs",
  instructions: [
    "Analyze code for race conditions and deadlocks",
    "Identify synchronization issues",
    "Provide thread-safe solutions",
    "Explain concurrency patterns and best practices"
  ],
  output: [
    "Identification of concurrency issues",
    "Explanation of race conditions or deadlocks",
    "Thread-safe code solutions",
    "Concurrency best practices and patterns"
  ],
  examples: [
    "Example: Fix a Java application with race conditions in multi-threaded code"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Security Vulnerability Debugging Stimulus
 */
export const SecurityDebuggingStimulus = new Stimulus({
  id: 'security-debugging',
  name: 'Security Vulnerability Debugging',
  description: 'Test models\' ability to identify and fix security vulnerabilities',
  
  role: "security engineer and penetration tester",
  objective: "identify and fix security vulnerabilities in code",
  instructions: [
    "Analyze code for security vulnerabilities",
    "Identify common security issues (SQL injection, XSS, etc.)",
    "Provide secure code solutions",
    "Explain security best practices"
  ],
  output: [
    "Identification of security vulnerabilities",
    "Explanation of attack vectors",
    "Secure code implementations",
    "Security best practices and recommendations"
  ],
  examples: [
    "Example: Fix a web application vulnerable to SQL injection attacks"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});
