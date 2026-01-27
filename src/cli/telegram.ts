import { Command } from "commander";
import { Stimulus } from "../stimulus/stimulus.js";
import { TelegramAdapter } from "../ui/telegram/TelegramAdapter.js";
import { addCommonOptions, parseCommonOptions } from "./commonOptions.js";
import { calculatorTool, statisticsTool, randomNumberTool } from "../stimulus/tools/index.js";
import path from "path";

export const telegramCommand = addCommonOptions(
  new Command("telegram")
    .description("Start a Telegram bot for chatting with AI models")
    .option("--token <token>", "Telegram bot token (or set TELEGRAM_BOT_TOKEN env)")
    .option("--memory", "Enable memory-augmented conversations")
    .option("--tools <tools>", "Comma-separated list of tools to enable (calculator,statistics,randomNumber)")
    .option("--media-dir <dir>", "Directory for storing media files (default: ./telegram-media)")
).action(async (options: any) => {
  const { provider, model } = parseCommonOptions(options);

  if (!provider || !model) {
    console.error("Both --provider and --model are required.");
    process.exit(1);
  }

  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Telegram bot token is required. Use --token or set TELEGRAM_BOT_TOKEN environment variable.");
    console.error("\nTo get a token:");
    console.error("1. Open Telegram and message @BotFather");
    console.error("2. Send /newbot and follow the prompts");
    console.error("3. Copy the token provided");
    process.exit(1);
  }

  // Create stimulus
  const stimulus = new Stimulus({
    role: "helpful AI assistant",
    objective: "assist users via Telegram chat",
    instructions: [
      "Be conversational and engaging",
      "Provide clear and helpful responses",
      "When sharing code, use proper formatting",
    ],
    runnerType: options.memory ? "memory" : "base",
    maxToolSteps: 5,
  });

  // Add tools if specified
  if (options.tools) {
    const toolNames = options.tools.split(",").map((t: string) => t.trim()).filter(Boolean);
    const knownTools: Record<string, any> = {
      calculator: calculatorTool,
      statistics: statisticsTool,
      randomNumber: randomNumberTool,
    };

    for (const name of toolNames) {
      const tool = knownTools[name];
      if (tool) {
        stimulus.addTool(name, tool);
      } else {
        console.warn(`[WARN] Tool '${name}' not found and will be ignored.`);
        console.warn(`Available tools: ${Object.keys(knownTools).join(", ")}`);
      }
    }
  }

  const modelDetails = {
    name: model,
    provider: provider,
  };

  try {
    // Default media directory in project root
    const mediaDir = options.mediaDir || path.join(process.cwd(), "telegram-media");
    
    const adapter = new TelegramAdapter({
      token,
      modelDetails,
      stimulus,
      mediaDir,
    });

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await adapter.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await adapter.stop();
      process.exit(0);
    });

    await adapter.start();
  } catch (error) {
    console.error("Failed to start Telegram bot:", error);
    process.exit(1);
  }
});
