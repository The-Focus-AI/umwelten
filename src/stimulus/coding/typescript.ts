import { Stimulus } from '../../stimulus/stimulus.js';
import { z } from 'zod';

/**
 * TypeScript Code Generation Stimulus
 * 
 * Tests models' ability to generate TypeScript code.
 * This evaluates:
 * - Understanding of TypeScript syntax and features
 * - Code quality and best practices
 * - Problem-solving abilities
 * - Ability to follow specifications
 */
export const TypeScriptStimulus = new Stimulus({
  id: 'typescript-basic',
  name: 'TypeScript Code Generation',
  description: 'Test models\' ability to generate TypeScript code',
  
  role: "senior TypeScript developer",
  objective: "write clean, well-typed TypeScript code",
  instructions: [
    "Write TypeScript code that follows best practices",
    "Use proper type annotations and interfaces",
    "Include error handling where appropriate",
    "Write clean, readable, and maintainable code"
  ],
  output: [
    "Complete TypeScript code with proper types",
    "Include necessary imports and exports",
    "Add comments for complex logic",
    "Follow TypeScript conventions and best practices"
  ],
  examples: [
    "Example: Create a function that processes user data with proper typing and validation"
  ],
  temperature: 0.3, // Lower temperature for more consistent code
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * TypeScript with Zod validation stimulus
 */
export const TypeScriptZodStimulus = new Stimulus({
  id: 'typescript-zod',
  name: 'TypeScript with Zod Validation',
  description: 'Test models\' ability to generate TypeScript code with Zod schemas',
  
  role: "TypeScript developer specializing in runtime validation",
  objective: "write TypeScript code with Zod validation schemas",
  instructions: [
    "Write TypeScript code that uses Zod for runtime validation",
    "Create proper type definitions from Zod schemas",
    "Include input validation and error handling",
    "Use Zod's built-in validation methods"
  ],
  output: [
    "TypeScript code with Zod schemas",
    "Type definitions derived from Zod schemas",
    "Validation functions with proper error handling",
    "Example usage of the validation"
  ],
  examples: [
    "Example: Create a user registration function with Zod validation for email, password, and profile data"
  ],
  temperature: 0.2, // Very low temperature for precise code generation
  maxTokens: 1200,
  runnerType: 'base'
});

/**
 * TypeScript API client stimulus
 */
export const TypeScriptAPIClientStimulus = new Stimulus({
  id: 'typescript-api-client',
  name: 'TypeScript API Client',
  description: 'Test models\' ability to create TypeScript API clients',
  
  role: "TypeScript developer specializing in API integration",
  objective: "create robust TypeScript API clients",
  instructions: [
    "Create a TypeScript API client with proper typing",
    "Include error handling and retry logic",
    "Use modern async/await patterns",
    "Add proper JSDoc documentation"
  ],
  output: [
    "Complete TypeScript API client class",
    "Type definitions for API requests and responses",
    "Error handling and retry mechanisms",
    "Usage examples and documentation"
  ],
  examples: [
    "Example: Create a REST API client for a user management service with CRUD operations"
  ],
  temperature: 0.3,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * TypeScript React component stimulus
 */
export const TypeScriptReactStimulus = new Stimulus({
  id: 'typescript-react',
  name: 'TypeScript React Component',
  description: 'Test models\' ability to create TypeScript React components',
  
  role: "React developer specializing in TypeScript",
  objective: "create well-typed React components in TypeScript",
  instructions: [
    "Create React components with proper TypeScript typing",
    "Use React hooks with correct type annotations",
    "Include proper prop types and interfaces",
    "Follow React and TypeScript best practices"
  ],
  output: [
    "Complete React component in TypeScript",
    "Proper prop types and interfaces",
    "Type-safe hook usage",
    "Clean, readable component structure"
  ],
  examples: [
    "Example: Create a user profile component with TypeScript props and state management"
  ],
  temperature: 0.3,
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * TypeScript utility functions stimulus
 */
export const TypeScriptUtilsStimulus = new Stimulus({
  id: 'typescript-utils',
  name: 'TypeScript Utility Functions',
  description: 'Test models\' ability to create TypeScript utility functions',
  
  role: "TypeScript developer specializing in utility functions",
  objective: "create reusable TypeScript utility functions",
  instructions: [
    "Write generic utility functions with proper TypeScript generics",
    "Include comprehensive type constraints",
    "Add JSDoc documentation with examples",
    "Use modern TypeScript features like conditional types when appropriate"
  ],
  output: [
    "Generic utility functions with proper typing",
    "Type constraints and generic parameters",
    "JSDoc documentation with examples",
    "Usage examples demonstrating the utilities"
  ],
  examples: [
    "Example: Create utility functions for deep cloning, debouncing, and type-safe object manipulation"
  ],
  temperature: 0.2,
  maxTokens: 1200,
  runnerType: 'base'
});
