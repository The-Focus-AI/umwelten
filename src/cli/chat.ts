import { Command } from "commander";
import { Interaction } from "../interaction/interaction.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { ModelRunner } from "../cognition/types.js";
import { createMemoryRunner } from "../memory/memory_runner.js";
import { getModel } from "../providers/index.js";
import readline from "readline";
import { InMemoryMemoryStore } from "../memory/memory_store.js";
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { setupConversation } from './conversationUtils.js';
import { getTool } from '../stimulus/tools/registry.js';

export const chatCommand = addCommonOptions(
  new Command("chat")
    .description(
      "Chat interactively with a model, optionally including a file. Requires --provider and --model."
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

  const modelInstance = await getModel(modelDetails);
  if (!modelInstance) {
    console.error("Failed to load the model.");
    process.exit(1);
  }

  // Parse tools
  let toolSet: Record<string, any> | undefined = undefined;
  if (options.tools) {
    const toolNames = options.tools.split(',').map((t: string) => t.trim()).filter(Boolean);
    toolSet = {};
    for (const name of toolNames) {
      const tool = getTool(name);
      if (tool) {
        (toolSet as Record<string, any>)[name] = tool;
      } else {
        console.warn(`[WARN] Tool '${name}' not found and will be ignored.`);
      }
    }
    if (process.env.DEBUG === '1') console.log("[DEBUG] Tool set:", Object.keys(toolSet));
  }

  // Prompt for the first message
  let firstMessage = '';
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  // Ask for the first message
  rl.question("You: ", async (line) => {
    firstMessage = line.trim();
    const conversation = await setupConversation({ modelDetails, prompt: firstMessage, attach, debug });
    if (toolSet) {
      conversation.setTools(toolSet);
    } else {
      conversation.setTools({}); // Explicitly set no tools
    }
    let runner: ModelRunner;
    let memoryStore = new InMemoryMemoryStore();
    if (options.memory) {
      runner = createMemoryRunner({
        baseRunner: new BaseModelRunner(),
        llmModel: model,
        memoryStore: memoryStore,
      });
    } else {
      runner = new BaseModelRunner();
    }
    // Stream the model's response
    process.stdout.write("Model: ");
    try {
      const response = await runner.streamText(conversation);
      if (response?.content) {
        process.stdout.write(response.content + "\n");
      } else {
        process.stdout.write("[No response]\n");
      }
    } catch (err) {
      console.error("[ERROR] Model execution failed.");
      if (debug) {
        console.error(err);
      }
    }
    // Now enter the interactive loop for further messages
    rl.setPrompt("You: ");
    rl.prompt();
    rl.on("line", async (line) => {
      const message = line.trim();
      if (
        message.toLowerCase() === "exit" ||
        message.toLowerCase() === "quit"
      ) {
        rl.close();
        return;
      }
      // Handle special commands
      if (message === "/?") {
        console.log("Available commands:");
        console.log("  /?         Show this help message");
        console.log("  /reset     Clear the conversation history");
        console.log("  /mem       Show memory facts (if memory enabled)");
        console.log("  /history   Show chat message history");
        console.log("  exit, quit End the chat session");
        rl.prompt();
        return;
      }
      if (message === "/reset") {
        conversation.clearContext();
        console.log("Conversation history cleared.");
        rl.prompt();
        return;
      }
      if (message === "/history") {
        console.log("Conversation history:");
        for (const msg of conversation.getMessages()) {
          console.log(msg.role, msg.content);
        }
        rl.prompt();
        return;
      }
      if (message === "/mem" && options.memory) {
        const facts = await memoryStore.getFacts(conversation.userId);
        if (facts.length === 0) {
          console.log("No memory facts stored.");
        } else {
          console.log("Memory facts:");
          for (const fact of facts) {
            console.log(`- ${fact.text}`);
          }
        }
        rl.prompt();
        return;
      }
      // Normal chat message
      conversation.addMessage({ role: "user", content: message });
      process.stdout.write("Model: ");
      try {
        const response = await runner.streamText(conversation);
        if (response?.content) {
          process.stdout.write(response.content + "\n");
        } else {
          process.stdout.write("[No response]\n");
        }
      } catch (err) {
        console.error("[ERROR] Model execution failed.");
        if (debug) {
          console.error(err);
        }
      }
      rl.prompt();
    });
    rl.on("close", () => {
      console.log("Chat session ended.");
      process.exit(0);
    });
  });
});
