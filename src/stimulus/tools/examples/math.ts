import { z } from "zod";
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../types.js";

// Schema definitions
const calculatorSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
  a: z.number().describe("The first number"),
  b: z.number().describe("The second number"),
});

const randomNumberSchema = z.object({
  min: z.number().describe("The minimum value (inclusive)"),
  max: z.number().describe("The maximum value (inclusive for integers, exclusive for decimals)"),
  integer: z.boolean().default(false).describe("Whether to generate an integer (true) or decimal (false)"),
});

const statisticsSchema = z.object({
  numbers: z.array(z.number()).min(1).describe("Array of numbers to analyze"),
});

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
export const calculatorTool: ToolDefinition<typeof calculatorSchema> = {
  name: "calculator",
  description: "Performs basic arithmetic operations (add, subtract, multiply, divide)",
  parameters: calculatorSchema,
  execute: async (args, context): Promise<ToolExecutionResult> => {
    const { operation, a, b } = args;
    
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
      result: {
        operation,
        operands: [a, b],
        result,
        expression: `${a} ${getOperationSymbol(operation)} ${b} = ${result}`,
      },
      metadata: {
        success: true,
        warnings: b === 0 && operation === "divide" ? ["Division by zero attempted"] : undefined,
      },
    };
  },
  metadata: {
    category: "math",
    tags: ["arithmetic", "calculator", "basic"],
    version: "1.0.0",
  },
};

/**
 * Random number generator tool
 */
export const randomNumberTool: ToolDefinition<typeof randomNumberSchema> = {
  name: "randomNumber",
  description: "Generates a random number within a specified range",
  parameters: randomNumberSchema,
  execute: async (args, context): Promise<ToolExecutionResult> => {
    const { min, max, integer } = args;
    
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
      result: {
        value: result,
        range: { min, max },
        type: integer ? "integer" : "decimal",
      },
      metadata: {
        success: true,
      },
    };
  },
  metadata: {
    category: "math",
    tags: ["random", "number", "generator"],
    version: "1.0.0",
  },
};

/**
 * Statistics tool for basic statistical calculations
 */
export const statisticsTool: ToolDefinition<typeof statisticsSchema> = {
  name: "statistics",
  description: "Calculates basic statistics (mean, median, mode, standard deviation) for a list of numbers",
  parameters: statisticsSchema,
  execute: async (args, context): Promise<ToolExecutionResult> => {
    const { numbers } = args;
    
    if (numbers.length === 0) {
      throw new Error("Cannot calculate statistics for an empty array");
    }
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    
    // Calculate median
    const median = numbers.length % 2 === 0
      ? (sorted[numbers.length / 2 - 1] + sorted[numbers.length / 2]) / 2
      : sorted[Math.floor(numbers.length / 2)];
    
    // Calculate mode
    const frequency: Record<number, number> = {};
    numbers.forEach(num => {
      frequency[num] = (frequency[num] || 0) + 1;
    });
    
    const maxFreq = Math.max(...Object.values(frequency));
    const modes = Object.keys(frequency)
      .filter(key => frequency[Number(key)] === maxFreq)
      .map(Number);
    
    // Calculate standard deviation
    const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;
    const standardDeviation = Math.sqrt(variance);

    return {
      result: {
        count: numbers.length,
        mean: Number(mean.toFixed(6)),
        median: Number(median.toFixed(6)),
        mode: modes.length === numbers.length ? null : modes,
        standardDeviation: Number(standardDeviation.toFixed(6)),
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        range: Math.max(...numbers) - Math.min(...numbers),
      },
      metadata: {
        success: true,
      },
    };
  },
  metadata: {
    category: "math",
    tags: ["statistics", "analysis", "data"],
    version: "1.0.0",
  },
};