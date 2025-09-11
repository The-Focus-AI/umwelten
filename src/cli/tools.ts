import { Command } from "commander";
import { Interaction } from "../interaction/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { getModel } from "../providers/index.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import {
  calculatorTool,
  randomNumberTool,
  statisticsTool,
} from "../stimulus/tools/index.js";

export async function runToolsDemo(options: any) {
  try {
    const commonOptions = parseCommonOptions(options);
    const { provider, model } = commonOptions;
    if (!provider || !model) {
      console.error("❌ Provider and model are required");
      process.exit(1);
    }
    if (process.env.DEBUG === '1') console.log(`[DEBUG] Provider: ${provider}, Model: ${model}`);
    console.log("🚀 Starting tools demonstration...\n");
    // Get model
    const modelInstance = await getModel({ name: model, provider });
    if (!modelInstance) {
      console.error("❌ Failed to get model");
      process.exit(1);
    }
    if (process.env.DEBUG === '1') console.log("[DEBUG] modelInstance:", modelInstance);
    // Create stimulus with tools
    const toolSet: Record<string, any> = {
      calculator: calculatorTool,
      randomNumber: randomNumberTool,
      statistics: statisticsTool,
    };
    
    const stimulus = new Stimulus({
      role: "helpful assistant with access to mathematical tools",
      objective: "perform calculations and mathematical operations using available tools",
      instructions: [
        "You MUST use the available tools to perform calculations and mathematical operations",
        "When asked to calculate something, use the calculator tool",
        "When asked to generate random numbers, use the randomNumber tool", 
        "When asked for statistics, use the statistics tool",
        "Always use the appropriate tool and then provide a clear explanation of the results"
      ],
      tools: toolSet,
      maxToolSteps: parseInt(options.maxSteps ?? '5'),
      runnerType: 'base'
    });

    // Create interaction with stimulus
    const interaction = new Interaction({ name: model, provider }, stimulus);
    // Add user message
    interaction.addMessage({ 
      role: "user", 
      content: `${options.prompt}\n\nPlease use the available tools to perform these calculations and show me the results.` 
    });
    console.log("📝 User prompt:", options.prompt);
    console.log("🔧 Available tools:", Object.keys(toolSet).join(", "));
    console.log("🔄 Max steps:", options.maxSteps ?? '5');
    console.log("\n🤖 AI Response:\n");
    // Execute with tools
    const runner = new BaseModelRunner();
    if (process.env.DEBUG === '1') console.log("[DEBUG] About to call runner.streamText(interaction)");
    let response = await runner.streamText(interaction);
    if (process.env.DEBUG === '1') console.log("[DEBUG] After await runner.streamText(interaction)");
    if (process.env.DEBUG === '1') console.log("[DEBUG] typeof response:", typeof response);
    if (process.env.DEBUG === '1') console.log("[DEBUG] response:", response);
    console.dir(response, { depth: null });
    if (response && 'response' in response && typeof (response as any).response !== 'undefined') {
      if (process.env.DEBUG === '1') console.log("\n[DEBUG] Raw provider response:");
      console.dir((response as any).response, { depth: null });
    }
    if (response.content) {
      console.log("\n[MODEL CONTENT]:");
      console.log(response.content);
    }
    if ('result' in response && (response as any).result) {
      console.log("\n[MODEL RESULT]:");
      console.log((response as any).result);
    }
    
    // Check for tool calls and results in the response
    if (response.metadata && (response.metadata as any).toolCalls) {
      console.log("\n[TOOL CALLS]:");
      const toolCalls = await (response.metadata as any).toolCalls;
      console.log(toolCalls);
    }
    if (response.metadata && (response.metadata as any).toolResults) {
      console.log("\n[TOOL RESULTS]:");
      const toolResults = await (response.metadata as any).toolResults;
      console.log(toolResults);
    }
    
    // If no content was returned, show a more helpful message
    if (!response.content && !('result' in response && (response as any).result)) {
      console.log("\n[NO CONTENT OR RESULT RETURNED]");
      console.log("This might indicate that the model used tools but didn't return final text content.");
      console.log("Check the debug output above for tool calls and results.");
    }
    console.log("\n\n📊 Execution Summary:");
    console.log("=====================");
    console.log("✅ Response generated successfully");
    console.log(`💰 Cost: ${response.metadata.cost ? `$${response.metadata.cost.totalCost.toFixed(6)}` : 'N/A'}`);
    console.log(`🎯 Tokens: ${response.metadata.tokenUsage.total} (${response.metadata.tokenUsage.promptTokens} prompt + ${response.metadata.tokenUsage.completionTokens} completion)`);
    console.log(`⏱️  Duration: ${response.metadata.endTime.getTime() - response.metadata.startTime.getTime()}ms`);
  } catch (err) {
    console.error("❌ Error during tools demo:", err);
  }
}

export function addToolsCommand(program: Command) {
  const toolsCommand = program
    .command("tools")
    .description("Demonstrate tool calling capabilities");

  // Tools are already registered in math.ts

  toolsCommand
    .command("list")
    .description("List all available built-in tools")
    .action(() => {
      const tools: Record<string, any> = {
        calculator: calculatorTool,
        randomNumber: randomNumberTool,
        statistics: statisticsTool,
      };

      console.log("\n🔧 Available Tools:");
      console.log("==================");

      Object.entries(tools).forEach(([name, tool]) => {
        console.log(`\n📋 ${name}`);
        console.log(`   Description: ${tool.description || 'No description'}`);
      });

      console.log(`\nTotal: ${Object.keys(tools).length} tools available\n`);
    });

  toolsCommand
    .command("demo")
    .description("Run a demo conversation with tools")
    .option("--prompt <prompt>", "Custom prompt to use", "Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]")
    .option("--max-steps <steps>", "Maximum number of tool execution steps", "5")
    .action(async (options) => {
      await runToolsDemo(options);
    });

  // Add common options to both subcommands
  addCommonOptions(toolsCommand.commands.find(cmd => cmd.name() === "demo")!);

  return toolsCommand;
}
