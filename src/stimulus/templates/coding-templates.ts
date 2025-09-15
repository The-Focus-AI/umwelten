import { Stimulus } from '../stimulus.js';

/**
 * Coding Templates
 * 
 * Generic templates for code generation and programming evaluations
 * that can be reused across different coding tests.
 */

export const CodeGenerationTemplate = {
  role: "senior software engineer",
  objective: "write clean, functional code",
  instructions: [
    "Write clean, readable code",
    "Include proper error handling",
    "Add appropriate comments and documentation",
    "Follow language-specific best practices",
    "Use appropriate design patterns",
    "Ensure code is maintainable and testable"
  ],
  output: [
    "Complete, functional code",
    "Proper error handling",
    "Clear documentation",
    "Follows best practices",
    "Appropriate design patterns",
    "Maintainable and testable code"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const DebuggingTemplate = {
  role: "debugging expert",
  objective: "identify and fix code issues",
  instructions: [
    "Analyze code for bugs and issues",
    "Identify root causes of problems",
    "Provide corrected code solutions",
    "Explain the debugging process",
    "Suggest prevention strategies",
    "Consider edge cases and error conditions"
  ],
  output: [
    "Identified issues and their causes",
    "Step-by-step debugging process",
    "Corrected code with explanations",
    "Prevention strategies",
    "Edge case considerations",
    "Testing recommendations"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base' as const
};

export const CodeReviewTemplate = {
  role: "senior code reviewer",
  objective: "review code for quality and best practices",
  instructions: [
    "Review code for quality and correctness",
    "Identify potential issues and improvements",
    "Check adherence to coding standards",
    "Evaluate performance and efficiency",
    "Assess security considerations",
    "Provide constructive feedback"
  ],
  output: [
    "Comprehensive code review",
    "Identified issues and improvements",
    "Standards compliance assessment",
    "Performance and efficiency notes",
    "Security considerations",
    "Constructive recommendations"
  ],
  temperature: 0.2,
  maxTokens: 1800,
  runnerType: 'base' as const
};

export const AlgorithmDesignTemplate = {
  role: "algorithm specialist",
  objective: "design efficient algorithms",
  instructions: [
    "Design algorithms to solve specific problems",
    "Consider time and space complexity",
    "Choose appropriate data structures",
    "Handle edge cases and error conditions",
    "Provide clear explanations of approach",
    "Consider alternative solutions"
  ],
  output: [
    "Well-designed algorithm",
    "Complexity analysis",
    "Appropriate data structures",
    "Edge case handling",
    "Clear explanation of approach",
    "Alternative solution considerations"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const TestingTemplate = {
  role: "test engineer",
  objective: "write comprehensive tests",
  instructions: [
    "Write comprehensive unit tests",
    "Cover edge cases and error conditions",
    "Use appropriate testing frameworks",
    "Follow testing best practices",
    "Ensure good test coverage",
    "Write clear, maintainable tests"
  ],
  output: [
    "Comprehensive test suite",
    "Edge case coverage",
    "Appropriate framework usage",
    "Testing best practices",
    "Good test coverage",
    "Clear, maintainable tests"
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base' as const
};

export const DocumentationTemplate = {
  role: "technical writer",
  objective: "write clear technical documentation",
  instructions: [
    "Write clear, comprehensive documentation",
    "Use appropriate technical language",
    "Include examples and code snippets",
    "Structure information logically",
    "Consider the target audience",
    "Keep documentation up to date"
  ],
  output: [
    "Clear, comprehensive documentation",
    "Appropriate technical language",
    "Helpful examples and snippets",
    "Logical information structure",
    "Audience-appropriate content",
    "Well-maintained documentation"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const RefactoringTemplate = {
  role: "refactoring specialist",
  objective: "improve code quality through refactoring",
  instructions: [
    "Identify areas for code improvement",
    "Apply appropriate refactoring techniques",
    "Maintain functionality while improving structure",
    "Improve readability and maintainability",
    "Consider performance implications",
    "Ensure all tests still pass"
  ],
  output: [
    "Improved code structure",
    "Applied refactoring techniques",
    "Maintained functionality",
    "Enhanced readability",
    "Performance considerations",
    "Verified test compatibility"
  ],
  temperature: 0.2,
  maxTokens: 1800,
  runnerType: 'base' as const
};

/**
 * Helper function to create a stimulus from a template
 */
export function createCodingStimulus(
  template: typeof CodeGenerationTemplate,
  overrides: Partial<typeof CodeGenerationTemplate> = {}
): Stimulus {
  return new Stimulus({
    ...template,
    ...overrides
  });
}
