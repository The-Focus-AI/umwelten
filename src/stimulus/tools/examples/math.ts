import { z } from "zod";
import { tool } from "ai";
import { registerTool } from "../simple-registry.js";

// Schema definitions
const calculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
  numbers: z.array(z.number()).length(2).describe("Array of two numbers to perform the operation on"),
}).or(z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
  a: z.number().describe("The first number"),
  b: z.number().describe("The second number"),
})).or(z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
  num1: z.number().describe("The first number"),
  num2: z.number().describe("The second number"),
})).or(z.object({
  expression: z.string().describe("Mathematical expression to evaluate"),
}));

const randomNumberSchema = z.object({
  min: z.number().describe("The minimum value (inclusive)"),
  max: z.number().describe("The maximum value (inclusive for integers, exclusive for decimals)"),
  integer: z.boolean().default(false).describe("Whether to generate an integer (true) or decimal (false)"),
}).or(z.object({
  min: z.number().describe("The minimum value (inclusive)"),
  max: z.number().describe("The maximum value (inclusive for integers, exclusive for decimals)"),
}));

const statisticsSchema = z.object({
  numbers: z.array(z.number()).min(1).describe("Array of numbers to analyze"),
}).or(z.object({
  data: z.array(z.number()).min(1).describe("Array of numbers to analyze"),
}));

// Helper functions
function getOperationSymbol(operation: string): string {
  switch (operation) {
    case "add": return "+";
    case "subtract": return "-";
    case "multiply": return "*";
    case "divide": return "/";
    default: return "?";
  }
}

// Tool definitions

/**
 * Calculator tool for basic arithmetic operations
 */
export const calculatorTool = tool({
  description: "Performs basic arithmetic operations (add, subtract, multiply, divide)",
  inputSchema: calculatorSchema,
  execute: async (params) => {
    console.log(`[CALCULATOR] Called with:`, params);
    
    // Handle expression format
    if ('expression' in params) {
      const expression = params.expression;
      // Simple expression parsing for basic operations
      const match = expression.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
      if (!match) {
        throw new Error(`Cannot parse expression: ${expression}`);
      }
      const [, num1Str, op, num2Str] = match;
      const a = parseInt(num1Str);
      const b = parseInt(num2Str);
      const operation = op === '+' ? 'add' : op === '-' ? 'subtract' : op === '*' ? 'multiply' : 'divide';
      
      let result: number;
      switch (operation) {
        case "add": result = a + b; break;
        case "subtract": result = a - b; break;
        case "multiply": result = a * b; break;
        case "divide": 
          if (b === 0) throw new Error("Division by zero is not allowed");
          result = a / b; 
          break;
        default: throw new Error(`Unsupported operation: ${operation}`);
      }
      
      return {
        operation,
        operands: [a, b],
        result,
        expression: `${a} ${op} ${b} = ${result}`,
      };
    }
    
    // Handle parameter formats
    let a: number, b: number;
    if ('numbers' in params && Array.isArray(params.numbers)) {
      [a, b] = params.numbers;
    } else if ('a' in params && 'b' in params) {
      a = params.a;
      b = params.b;
    } else if ('num1' in params && 'num2' in params) {
      a = params.num1;
      b = params.num2;
    } else {
      throw new Error("Invalid parameters: must provide either 'numbers' array, 'a' and 'b', or 'num1' and 'num2'");
    }
    
    const { operation } = params;
    
    let result: number;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          throw new Error("Division by zero is not allowed");
        }
        result = a / b;
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    return {
      operation,
      operands: [a, b],
      result,
      expression: `${a} ${getOperationSymbol(operation)} ${b} = ${result}`,
    };
  },
});

// Register the tool
registerTool('calculator', calculatorTool);

/**
 * Random number generator tool
 */
export const randomNumberTool = tool({
  description: "Generates a random number within a specified range",
  inputSchema: randomNumberSchema,
  execute: async (params) => {
    console.log(`[RANDOM] Called with:`, params);
    
    const { min, max } = params;
    const integer = 'integer' in params ? params.integer : false;
    
    if (min >= max) {
      throw new Error("Minimum value must be less than maximum value");
    }
    
    let result: number;
    if (integer) {
      result = Math.floor(Math.random() * (max - min + 1)) + min;
    } else {
      result = Math.random() * (max - min) + min;
    }

    return {
      value: result,
      range: { min, max },
      type: integer ? "integer" : "decimal",
    };
  },
});

// Register the tool
registerTool('randomNumber', randomNumberTool);

/**
 * Statistics tool for basic statistical calculations
 */
export const statisticsTool = tool({
  description: "Calculates basic statistics (mean, median, mode, standard deviation) for a list of numbers",
  inputSchema: statisticsSchema,
  execute: async (params) => {
    console.log(`[STATISTICS] Called with:`, params);
    
    // Handle both parameter formats
    const numbers = 'numbers' in params ? params.numbers : params.data;
    
    if (numbers.length === 0) {
      throw new Error("Cannot calculate statistics for an empty array");
    }
    
    const sorted = [...numbers].sort((a: number, b: number) => a - b);
    const mean = numbers.reduce((sum: number, num: number) => sum + num, 0) / numbers.length;
    
    // Calculate median
    const median = numbers.length % 2 === 0
      ? (sorted[numbers.length / 2 - 1] + sorted[numbers.length / 2]) / 2
      : sorted[Math.floor(numbers.length / 2)];
    
    // Calculate mode
    const frequency: Record<number, number> = {};
    numbers.forEach((num: number) => {
      frequency[num] = (frequency[num] || 0) + 1;
    });
    
    const maxFreq = Math.max(...Object.values(frequency));
    const modes = Object.keys(frequency)
      .filter(key => frequency[Number(key)] === maxFreq)
      .map(Number);
    
    // Calculate standard deviation
    const variance = numbers.reduce((sum: number, num: number) => sum + Math.pow(num - mean, 2), 0) / numbers.length;
    const standardDeviation = Math.sqrt(variance);

    return {
      count: numbers.length,
      mean: Number(mean.toFixed(6)),
      median: Number(median.toFixed(6)),
      mode: modes.length === numbers.length ? null : modes,
      standardDeviation: Number(standardDeviation.toFixed(6)),
      min: Math.min(...numbers),
      max: Math.max(...numbers),
      range: Math.max(...numbers) - Math.min(...numbers),
    };
  },
});

// Register the tool
registerTool('statistics', statisticsTool);