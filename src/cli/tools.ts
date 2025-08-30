import { Command } from "commander";
import { Interaction } from "../interaction/interaction.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { getModel } from "../providers/index.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { 
  calculatorTool, 
  randomNumberTool, 
  statisticsTool,
  listTools,
  getAllTools
} from "../stimulus/tools/index.js";

export function addToolsCommand(program: Command) {
  const toolsCommand = program
    .command("tools")
    .description("Demonstrate tool calling capabilities");

  // Tools are already registered in math.ts

  toolsCommand
    .command("list")
    .description("List all available tools")
    .action(() => {
      const tools = getAllTools();
      
      console.log("\n🔧 Available Tools:");
      console.log("==================");
      
      if (Object.keys(tools).length === 0) {
        console.log("No tools registered.");
        return;
      }

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
      try {
        const commonOptions = parseCommonOptions(options);
        const { provider, model, debug } = commonOptions;
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
        // Create interaction with tools
        const interaction = new Interaction(
          { name: model, provider },
          "You are a helpful assistant with access to mathematical tools. Use the available tools to help answer questions and perform calculations."
        );
        // Set up tools
        const toolSet = getAllTools();
        interaction.setTools(toolSet);
        interaction.setMaxSteps(parseInt(options.maxSteps));
        // Add user message
        interaction.addMessage({
          role: "user",
          content: options.prompt,
        });
        console.log("📝 User prompt:", options.prompt);
        console.log("🔧 Available tools:", Object.keys(toolSet).join(", "));
        console.log("🔄 Max steps:", options.maxSteps);
        console.log("\n🤖 AI Response:\n");
        // Execute with tools
        const runner = new BaseModelRunner();
        if (process.env.DEBUG === '1') console.log("[DEBUG] About to call runner.streamText(interaction)");
        let response;
        try {
          response = await runner.streamText(interaction);
        } catch (err) {
          console.error("[DEBUG] Error thrown by runner.streamText:", err);
          throw err;
        }
        if (process.env.DEBUG === '1') console.log("[DEBUG] After await runner.streamText(interaction)");
        if (process.env.DEBUG === '1') console.log("[DEBUG] typeof response:", typeof response);
        if (process.env.DEBUG === '1') console.log("[DEBUG] response:", response);

        // Print the full response for debugging
        if (process.env.DEBUG === '1') console.log("\n[DEBUG] Full model response:");
        console.dir(response, { depth: null });
        if (response && 'response' in response && typeof (response as any).response !== 'undefined') {
          if (process.env.DEBUG === '1') console.log("\n[DEBUG] Raw provider response:");
          console.dir((response as any).response, { depth: null });
        }

        // Print content/result if present
        if (response.content) {
          console.log("\n[MODEL CONTENT]:");
          console.log(response.content);
        }
        if ('result' in response && (response as any).result) {
          console.log("\n[MODEL RESULT]:");
          console.log((response as any).result);
        }
        if (!response.content && !('result' in response && (response as any).result)) {
          console.log("\n[NO CONTENT OR RESULT RETURNED]");
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
    });

  // Add common options to both subcommands
  addCommonOptions(toolsCommand.commands.find(cmd => cmd.name() === "demo")!);

  return toolsCommand;
}