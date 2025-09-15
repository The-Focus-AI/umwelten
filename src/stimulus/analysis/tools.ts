import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Tool Usage Stimulus
 * 
 * Tests models' ability to use tools effectively in their responses.
 * This evaluates:
 * - Tool selection and usage
 * - Parameter handling and validation
 * - Tool result interpretation
 * - Integration of tool results into responses
 */
export const ToolUsageStimulus = new Stimulus({
  id: 'tool-usage',
  name: 'Tool Usage',
  description: 'Test models\' ability to use tools effectively in their responses',
  
  role: "AI assistant with access to tools",
  objective: "use available tools effectively to provide accurate and helpful responses",
  instructions: [
    "Use appropriate tools when needed to gather information",
    "Handle tool parameters correctly and validate inputs",
    "Interpret tool results accurately",
    "Integrate tool results seamlessly into your responses"
  ],
  output: [
    "Appropriate tool usage when needed",
    "Correct parameter handling and validation",
    "Accurate interpretation of tool results",
    "Seamless integration of tool results into responses"
  ],
  examples: [
    "Example: Use a calculator tool to solve a math problem and explain the result"
  ],
  temperature: 0.3, // Lower temperature for more consistent tool usage
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * Weather Tool Usage Stimulus
 */
export const WeatherToolStimulus = new Stimulus({
  id: 'weather-tool-usage',
  name: 'Weather Tool Usage',
  description: 'Test models\' ability to use weather tools effectively',
  
  role: "AI assistant with weather tool access",
  objective: "use weather tools to provide accurate weather information",
  instructions: [
    "Use weather tools to get current weather data",
    "Handle location parameters correctly (names or coordinates)",
    "Interpret weather data accurately",
    "Provide clear and helpful weather information"
  ],
  output: [
    "Accurate weather tool usage",
    "Correct location parameter handling",
    "Clear weather data interpretation",
    "Helpful weather information presentation"
  ],
  examples: [
    "Example: Use weather tool to get current weather for 'New York' and present the information clearly"
  ],
  temperature: 0.3,
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * Calculator Tool Usage Stimulus
 */
export const CalculatorToolStimulus = new Stimulus({
  id: 'calculator-tool-usage',
  name: 'Calculator Tool Usage',
  description: 'Test models\' ability to use calculator tools effectively',
  
  role: "AI assistant with calculator tool access",
  objective: "use calculator tools to solve mathematical problems",
  instructions: [
    "Use calculator tools for mathematical calculations",
    "Handle mathematical expressions correctly",
    "Interpret calculation results accurately",
    "Provide clear explanations of mathematical solutions"
  ],
  output: [
    "Accurate calculator tool usage",
    "Correct mathematical expression handling",
    "Clear calculation result interpretation",
    "Helpful mathematical explanations"
  ],
  examples: [
    "Example: Use calculator tool to solve '15 * 23 + 45' and explain the calculation"
  ],
  temperature: 0.2, // Very low temperature for precise mathematical calculations
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * File Analysis Tool Usage Stimulus
 */
export const FileAnalysisToolStimulus = new Stimulus({
  id: 'file-analysis-tool-usage',
  name: 'File Analysis Tool Usage',
  description: 'Test models\' ability to use file analysis tools effectively',
  
  role: "AI assistant with file analysis tool access",
  objective: "use file analysis tools to provide file information",
  instructions: [
    "Use file analysis tools to examine files",
    "Handle file path parameters correctly",
    "Interpret file analysis results accurately",
    "Provide clear file information and insights"
  ],
  output: [
    "Accurate file analysis tool usage",
    "Correct file path parameter handling",
    "Clear file analysis result interpretation",
    "Helpful file information and insights"
  ],
  examples: [
    "Example: Use file analysis tool to examine a text file and provide size, content preview, and metadata"
  ],
  temperature: 0.3,
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * Multi-Tool Usage Stimulus
 */
export const MultiToolUsageStimulus = new Stimulus({
  id: 'multi-tool-usage',
  name: 'Multi-Tool Usage',
  description: 'Test models\' ability to use multiple tools effectively in sequence',
  
  role: "AI assistant with access to multiple tools",
  objective: "use multiple tools effectively to solve complex problems",
  instructions: [
    "Use multiple tools in sequence when needed",
    "Handle tool dependencies and data flow correctly",
    "Integrate results from multiple tools",
    "Provide comprehensive solutions using tool results"
  ],
  output: [
    "Effective multi-tool usage",
    "Correct tool sequencing and data flow",
    "Accurate integration of multiple tool results",
    "Comprehensive solutions using tool data"
  ],
  examples: [
    "Example: Use weather tool to get current conditions, then calculator tool to convert temperature, then provide a comprehensive weather report"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});
