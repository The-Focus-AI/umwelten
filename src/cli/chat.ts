import { Command } from "commander";
import { ChatInteraction, CLIInterface } from "../ui/index.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { getTool } from '../stimulus/tools/simple-registry.js';
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
    // Create chat interaction with the new pattern
    const chatInteraction = new ChatInteraction(modelDetails, undefined, options.memory);
    
    // Handle custom tools if specified
    if (options.tools) {
      const toolNames = options.tools.split(',').map((t: string) => t.trim()).filter(Boolean);
      const customTools: Record<string, any> = {};
      
      for (const name of toolNames) {
        const tool = getTool(name);
        if (tool) {
          customTools[name] = tool;
        } else {
          console.warn(`[WARN] Tool '${name}' not found and will be ignored.`);
        }
      }
      
      if (Object.keys(customTools).length > 0) {
        // Replace default tools with custom tools
        chatInteraction.setTools(customTools);
        if (process.env.DEBUG === '1') console.log("[DEBUG] Custom tools set:", Object.keys(customTools));
      }
    }
    
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

    // Create CLI interface and start chat
    const cliInterface = new CLIInterface();
    await cliInterface.startChat(chatInteraction);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
});
