import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Python Code Generation Stimulus
 * 
 * Tests models' ability to generate Python code.
 * This evaluates:
 * - Understanding of Python syntax and features
 * - Code quality and best practices
 * - Problem-solving abilities
 * - Ability to follow specifications
 */
export const PythonStimulus = new Stimulus({
  id: 'python-basic',
  name: 'Python Code Generation',
  description: 'Test models\' ability to generate Python code',
  
  role: "senior Python developer",
  objective: "write clean, well-structured Python code",
  instructions: [
    "Write Python code that follows PEP 8 style guidelines",
    "Use proper type hints and docstrings",
    "Include error handling where appropriate",
    "Write clean, readable, and maintainable code"
  ],
  output: [
    "Complete Python code with proper structure",
    "Include necessary imports and main guard",
    "Add docstrings for functions and classes",
    "Follow Python conventions and best practices"
  ],
  examples: [
    "Example: Create a function that processes user data with proper typing and validation"
  ],
  temperature: 0.3, // Lower temperature for more consistent code
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * Python with Data Science stimulus
 */
export const PythonDataScienceStimulus = new Stimulus({
  id: 'python-data-science',
  name: 'Python Data Science',
  description: 'Test models\' ability to create Python data science code',
  
  role: "data scientist and Python expert",
  objective: "create data science solutions using Python",
  instructions: [
    "Use pandas, numpy, and matplotlib/seaborn for data analysis",
    "Write clean, efficient data processing code",
    "Include proper data visualization",
    "Follow data science best practices"
  ],
  output: [
    "Complete data science Python script",
    "Data loading and preprocessing code",
    "Analysis and visualization code",
    "Clear documentation and comments"
  ],
  examples: [
    "Example: Analyze sales data and create visualizations showing trends and patterns"
  ],
  temperature: 0.3,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Python API development stimulus
 */
export const PythonAPIStimulus = new Stimulus({
  id: 'python-api',
  name: 'Python API Development',
  description: 'Test models\' ability to create Python APIs',
  
  role: "Python developer specializing in API development",
  objective: "create robust Python APIs using FastAPI or Flask",
  instructions: [
    "Create a Python API with proper structure",
    "Include request/response validation",
    "Add proper error handling and logging",
    "Use modern Python async patterns where appropriate"
  ],
  output: [
    "Complete Python API application",
    "API endpoints with proper documentation",
    "Request/response models and validation",
    "Error handling and logging setup"
  ],
  examples: [
    "Example: Create a REST API for a user management service with CRUD operations"
  ],
  temperature: 0.3,
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Python testing stimulus
 */
export const PythonTestingStimulus = new Stimulus({
  id: 'python-testing',
  name: 'Python Testing',
  description: 'Test models\' ability to write Python tests',
  
  role: "Python developer specializing in testing",
  objective: "create comprehensive Python test suites",
  instructions: [
    "Write unit tests using pytest or unittest",
    "Include test fixtures and mocking where appropriate",
    "Test edge cases and error conditions",
    "Follow testing best practices and patterns"
  ],
  output: [
    "Complete Python test suite",
    "Unit tests for all functions and methods",
    "Integration tests where appropriate",
    "Test fixtures and helper functions"
  ],
  examples: [
    "Example: Create a comprehensive test suite for a user authentication module"
  ],
  temperature: 0.3,
  maxTokens: 1000,
  runnerType: 'base'
});
