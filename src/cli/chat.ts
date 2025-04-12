import { Command } from "commander";
import { Conversation } from "../conversation/conversation.js";
import { BaseModelRunner } from "../models/runner.js";
import { getModel } from "../providers/index.js";
import readline from "readline";

export const chatCommand = new Command("chat")
  .description("Chat interactively with a model, optionally including a file. Requires --provider and --model.")
  .option("-p, --provider <provider>", "Provider to use (e.g. 'google', 'ollama', 'openrouter')")
  .option("-m, --model <model>", "Model name to use (e.g. 'gemini-pro', 'llama3', etc.)")
  .option("-f, --file <filePath>", "File to include in the chat")
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

    const conversation = new Conversation(modelDetails, "You are now in an interactive chat session.");
    if (options.file) {
      await conversation.addAttachmentFromPath(options.file);
    }

    const runner = new BaseModelRunner();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    console.log("Type your message and press Enter. Type 'exit' or 'quit' to end the chat.");
    rl.prompt();

    rl.on("line", async (line) => {
      const message = line.trim();
      if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
        rl.close();
        return;
      }
      conversation.addMessage({ role: "user", content: message });

      // Stream the model's response
      process.stdout.write("Model: ");
      const response = await runner.streamText(conversation);
      if (response?.content) {
        process.stdout.write(response.content + "\n");
      } else {
        process.stdout.write("[No response]\n");
      }

      console.log("Conversation history:");
      for( const message of conversation.getMessages()) {
        console.log(message.role, message.content);

      }
      rl.prompt();
    });

    rl.on("close", () => {
      console.log("Chat session ended.");
      process.exit(0);
    });
  });