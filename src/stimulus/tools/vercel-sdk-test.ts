import { generateText, tool } from 'ai';
import { ollama } from 'ai-sdk-ollama';
import { z } from 'zod';

// Define tools using Vercel AI SDK pattern
const calculatorTool = tool({
  description: "Performs basic arithmetic operations (add, subtract, multiply, divide)",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
    a: z.number().describe("The first number"),
    b: z.number().describe("The second number"),
  }),
  execute: async ({ operation, a, b }) => {
    console.log(`[VERCEL SDK] Calculator called with: operation=${operation}, a=${a}, b=${b}`);
    
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
      expression: `${a} ${operation} ${b} = ${result}`,
    };
  },
});

const statisticsTool = tool({
  description: "Calculates basic statistics for a list of numbers",
  inputSchema: z.object({
    numbers: z.array(z.number()).min(1).describe("Array of numbers to analyze"),
  }),
  execute: async ({ numbers }) => {
    console.log(`[VERCEL SDK] Statistics called with: numbers=${JSON.stringify(numbers)}`);
    
    const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    const sorted = [...numbers].sort((a, b) => a - b);
    const median = numbers.length % 2 === 0
      ? (sorted[numbers.length / 2 - 1] + sorted[numbers.length / 2]) / 2
      : sorted[Math.floor(numbers.length / 2)];

    return {
      count: numbers.length,
      mean: Number(mean.toFixed(6)),
      median: Number(median.toFixed(6)),
      min: Math.min(...numbers),
      max: Math.max(...numbers),
    };
  },
});

async function testDirectVercelSDK() {
  console.log('🧪 Testing direct Vercel AI SDK tool calling...\n');

  try {
    const result = await generateText({
      model: ollama('qwen3:latest'),
      tools: {
        calculator: calculatorTool,
        statistics: statisticsTool,
      },
      maxSteps: 3,
      prompt: 'Calculate 15 + 27 using the calculator tool, then calculate statistics for [10, 20, 30, 40, 50]',
    });

    console.log('\n📊 Vercel SDK Result:');
    console.log('Text:', result.text);
    console.log('Tool Calls:', result.toolCalls?.length || 0);
    console.log('Tool Results:', result.toolResults?.length || 0);
    
    if (result.toolCalls) {
      console.log('\n🔧 Tool Calls Details:');
      result.toolCalls.forEach((call, index) => {
        console.log(`  ${index + 1}. ${call.toolName}:`, call.input);
      });
    }

    if (result.toolResults) {
      console.log('\n📈 Tool Results Details:');
      result.toolResults.forEach((toolResult, index) => {
        console.log(`  ${index + 1}. ${toolResult.toolName}:`, toolResult.output);
      });
    }

    return result;
  } catch (error) {
    console.error('❌ Vercel SDK test failed:', error);
    throw error;
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testDirectVercelSDK()
    .then(() => {
      console.log('\n✅ Direct Vercel SDK test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Direct Vercel SDK test failed:', error);
      process.exit(1);
    });
}

export { testDirectVercelSDK };
