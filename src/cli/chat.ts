import { Command } from "commander";
import { Conversation } from "../conversation/conversation.js";
import { BaseModelRunner } from "../models/runner.js";
import { createMemoryRunner } from "../memory/memory_runner.js";
import { getModel } from "../providers/index.js";
import readline from "readline";
import { InMemoryMemoryStore } from "../memory/memory_store.js";
export const chatCommand = new Command("chat")
  .description(
    "Chat interactively with a model, optionally including a file. Requires --provider and --model."
  )
  .option(
    "-p, --provider <provider>",
    "Provider to use (e.g. 'google', 'ollama', 'openrouter')"
  )
  .option(
    "-m, --model <model>",
    "Model name to use (e.g. 'gemini-pro', 'llama3', etc.)"
  )
  .option("-f, --file <filePath>", "File to include in the chat")
  .option("--memory", "Enable memory-augmented chat (uses MemoryRunner)")
  .action(async (options) => {
    if (!options.provider || !options.model) {
      console.error("Both --provider and --model are required.");
      process.exit(1);
    }

    const modelDetails = {
      name: options.model,
      provider: options.provider,
    };

    const model = await getModel(modelDetails);
    if (!model) {
      console.error("Failed to load the model.");
      process.exit(1);
    }

    const conversation = new Conversation(
      modelDetails,
      "You are now in an interactive chat session."
    );
    if (options.file) {
      await conversation.addAttachmentFromPath(options.file);
    }
    let runner;
    let memoryStore = new InMemoryMemoryStore();
    if (options.memory) {
      runner = createMemoryRunner({
        baseRunner: new BaseModelRunner(),
        llmModel: options.model,
        memoryStore: memoryStore,
      });
    } else {
      runner = new BaseModelRunner();
    }
    // Removed duplicate runner declaration

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    console.log(
      "Type your message and press Enter. Type 'exit' or 'quit' to end the chat."
    );
    console.log("Type '/?' for a list of commands.");
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

      // Stream the model's response
      process.stdout.write("Model: ");
      const response = await runner.streamText(conversation);
      if (response?.content) {
        process.stdout.write(response.content + "\n");
      } else {
        process.stdout.write("[No response]\n");
      }

      rl.prompt();
    });

    rl.on("close", () => {
      console.log("Chat session ended.");
      process.exit(0);
    });
  });
