import { Command } from "commander";
import { Interaction } from "../interaction/interaction.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { getModel } from "../providers/index.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { 
  calculatorTool, 
  randomNumberTool, 
  statisticsTool,
  registerTool,
  listTools,
  ToolSet
} from "../stimulus/tools/index.js";

export function addToolsCommand(program: Command) {
  const toolsCommand = program
    .command("tools")
    .description("Demonstrate tool calling capabilities");

  // Register example tools
  registerTool(calculatorTool);
  registerTool(randomNumberTool);
  registerTool(statisticsTool);

  toolsCommand
    .command("list")
    .description("List all available tools")
    .action(() => {
      const tools = listTools();
      
      console.log("\n🔧 Available Tools:");
      console.log("==================");
      
      if (tools.length === 0) {
        console.log("No tools registered.");
        return;
      }

      tools.forEach((tool) => {
        console.log(`\n📋 ${tool.name}`);
        console.log(`   Description: ${tool.description}`);
        console.log(`   Category: ${tool.metadata?.category || 'uncategorized'}`);
        console.log(`   Tags: ${tool.metadata?.tags?.join(', ') || 'none'}`);
        console.log(`   Version: ${tool.metadata?.version || 'unknown'}`);
      });
      
      console.log(`\nTotal: ${tools.length} tools available\n`);
    });

  toolsCommand
    .command("demo")
    .description("Run a demo conversation with tools")
    .option("--prompt <prompt>", "Custom prompt to use", "Calculate 15 + 27, then generate a random number between 1 and 100, and finally calculate statistics for the numbers [10, 20, 30, 40, 50]")
    .option("--max-steps <steps>", "Maximum number of tool execution steps", "5")
    .action(async (options) => {
      const commonOptions = parseCommonOptions(options);
      
      try {
        console.log("🚀 Starting tools demonstration...\n");
        
        // Get model
        const model = await getModel(commonOptions.model);
        if (!model) {
          console.error("❌ Failed to get model");
          process.exit(1);
        }

        // Create interaction with tools
        const interaction = new Interaction(
          commonOptions.model,
          "You are a helpful assistant with access to mathematical tools. Use the available tools to help answer questions and perform calculations."
        );

        // Set up tools
        const toolSet: ToolSet = {
          calculator: calculatorTool as any,
          randomNumber: randomNumberTool as any,
          statistics: statisticsTool as any,
        };
        
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
        const response = await runner.streamText(interaction);

        console.log("\n\n📊 Execution Summary:");
        console.log("=====================");
        console.log("✅ Response generated successfully");
        console.log(`💰 Cost: ${response.metadata.cost ? `$${response.metadata.cost.totalCost.toFixed(6)}` : 'N/A'}`);
        console.log(`🎯 Tokens: ${response.metadata.tokenUsage.total} (${response.metadata.tokenUsage.promptTokens} prompt + ${response.metadata.tokenUsage.completionTokens} completion)`);
        console.log(`⏱️  Duration: ${response.metadata.endTime.getTime() - response.metadata.startTime.getTime()}ms`);
        
      } catch (error) {
        console.error("❌ Error during tools demo:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Add common options to both subcommands
  addCommonOptions(toolsCommand.commands.find(cmd => cmd.name() === "demo")!);

  return toolsCommand;
}