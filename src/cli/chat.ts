import { Command } from "commander";
import { Interaction } from "../interaction/core/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { CLIInterface } from "../ui/index.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { calculatorTool, statisticsTool, randomNumberTool } from '../stimulus/tools/index.js';
import { getChatCommands } from '../ui/cli/DefaultCommands.js';
import path from "path";
import fs from "fs";

export const chatCommand = addCommonOptions(
  new Command("chat")
    .description(
      "Chat interactively with a model using the new Interaction pattern. Requires --provider and --model."
    )
    .option("-f, --file <filePath>", "File to include in the chat")
    .option("--memory", "Enable memory-augmented chat (uses MemoryRunner)")
    .option("--tools <tools>", "Comma-separated list of tool names to enable (default: none)")
).action(async (options: any) => {
  const { provider, model, attach, debug } = parseCommonOptions(options);
  if (!provider || !model) {
    console.error("Both --provider and --model are required.");
    process.exit(1);
  }

  if (process.env.DEBUG === '1') console.log("[DEBUG] Options:", options);

  const modelDetails = {
    name: model,
    provider: provider,
  };

  if (process.env.DEBUG === '1') console.log("[DEBUG] Model details:", modelDetails);

  try {
    // Create chat stimulus with the new pattern
    const chatStimulus = new Stimulus({
      role: "helpful AI assistant",
      objective: "be conversational, engaging, and helpful",
      instructions: [
        "Always respond with text content first",
        "Only use tools when you need specific information",
        "Be conversational and engaging"
      ],
      runnerType: options.memory ? 'memory' : 'base',
      maxToolSteps: 5
    });
    
    // Add tools if specified
    if (options.tools) {
      const toolNames = options.tools.split(',').map((t: string) => t.trim()).filter(Boolean);
      const knownTools = {
        calculator: calculatorTool,
        statistics: statisticsTool,
        randomNumber: randomNumberTool,
      };

      for (const name of toolNames) {
        const tool = knownTools[name as keyof typeof knownTools];
        if (tool) {
          chatStimulus.addTool(name, tool);
        } else {
          console.warn(`[WARN] Tool '${name}' not found and will be ignored.`);
        }
      }

      if (process.env.DEBUG === '1') console.log("[DEBUG] Custom tools set:", Object.keys(chatStimulus.getTools()));
    }
    
    const chatInteraction = new Interaction(modelDetails, chatStimulus);
    
    // Handle file attachment if provided
    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File '${options.file}' does not exist.`);
        process.exit(1);
      }
      
      try {
        await chatInteraction.addAttachmentFromPath(filePath);
        console.log(`File attached: ${path.basename(filePath)}`);
      } catch (error) {
        console.error(`Error reading file '${options.file}':`, error);
        process.exit(1);
      }
    }

    // Create CLI interface and register chat commands
    const cliInterface = new CLIInterface();
    cliInterface.addCommands(getChatCommands());
    
    // Start chat
    await cliInterface.startChat(chatInteraction);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
});
