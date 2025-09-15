import { Stimulus } from '../../stimulus/stimulus.js';

export const AdvancedTypeScriptStimulus = new Stimulus({
  id: 'advanced-typescript',
  name: 'Advanced TypeScript Development',
  description: 'Test models\' ability to generate complex TypeScript code with advanced features',

  role: "senior TypeScript developer",
  objective: "write production-ready TypeScript code with advanced features",
  instructions: [
    "Use TypeScript's advanced type system including generics, utility types, and conditional types",
    "Implement proper error handling with custom error classes",
    "Use modern ES6+ features and async/await patterns",
    "Follow TypeScript best practices and coding standards",
    "Include comprehensive JSDoc comments for all public APIs",
    "Use proper module exports and imports",
    "Implement proper validation using Zod or similar libraries",
    "Include unit tests using Jest or Vitest"
  ],
  output: [
    "Complete TypeScript file with proper imports/exports",
    "Comprehensive type definitions",
    "Error handling and validation",
    "JSDoc documentation",
    "Unit tests",
    "README with usage examples"
  ],
  examples: [
    {
      input: "Create a generic API client with retry logic",
      output: `interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

class ApiClient<T> {
  constructor(private config: ApiClientConfig) {}
  
  async request<R>(endpoint: string, options?: RequestInit): Promise<R> {
    // Implementation with retry logic
  }
}`
    }
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});

export const ReactTypeScriptStimulus = new Stimulus({
  id: 'react-typescript',
  name: 'React TypeScript Development',
  description: 'Test models\' ability to create React components with TypeScript',

  role: "React TypeScript expert",
  objective: "create production-ready React components with TypeScript",
  instructions: [
    "Use React 18+ features and hooks",
    "Implement proper TypeScript interfaces for props and state",
    "Use proper event handling with TypeScript types",
    "Implement proper error boundaries and loading states",
    "Use modern React patterns like custom hooks",
    "Follow React best practices and performance optimization",
    "Include proper accessibility attributes",
    "Use proper CSS-in-JS or styled-components with TypeScript"
  ],
  output: [
    "Complete React component with TypeScript",
    "Proper prop and state interfaces",
    "Custom hooks if needed",
    "Error boundary implementation",
    "Accessibility features",
    "Unit tests with React Testing Library"
  ],
  examples: [
    {
      input: "Create a reusable Button component",
      output: `interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  children
}) => {
  return (
    <button
      className={\`btn btn-\${variant} btn-\${size}\`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
};`
    }
  ],
  temperature: 0.4,
  maxTokens: 1500,
  runnerType: 'base'
});

export const NodeJSTypeScriptStimulus = new Stimulus({
  id: 'nodejs-typescript',
  name: 'Node.js TypeScript Development',
  description: 'Test models\' ability to create Node.js applications with TypeScript',

  role: "Node.js TypeScript expert",
  objective: "create production-ready Node.js applications with TypeScript",
  instructions: [
    "Use Node.js 18+ features and modern APIs",
    "Implement proper error handling and logging",
    "Use proper TypeScript types for Node.js APIs",
    "Implement proper configuration management",
    "Use modern package managers and build tools",
    "Follow Node.js best practices and security guidelines",
    "Include proper environment variable handling",
    "Use proper database integration with TypeScript"
  ],
  output: [
    "Complete Node.js application with TypeScript",
    "Proper configuration and environment handling",
    "Error handling and logging",
    "Database integration",
    "API endpoints with proper types",
    "Docker configuration",
    "Unit and integration tests"
  ],
  examples: [
    {
      input: "Create a REST API with Express and TypeScript",
      output: `import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

const app = express();

interface User {
  id: string;
  name: string;
  email: string;
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email()
});

app.post('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userData = createUserSchema.parse(req.body);
    // Create user logic
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});`
    }
  ],
  temperature: 0.3,
  maxTokens: 2500,
  runnerType: 'base'
});
