#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { modelsCommand } from "./models.js";
import { runCommand } from "./run.js";
import { chatCommand } from "./chat.js";
import { addToolsCommand } from "./tools.js";
import {
	sessionsCommand,
	introspectCommand,
	browseCommand,
} from "@umwelten/sessions";
import { registerSessionsHabitatCommands } from "@umwelten/habitat";
import { telegramCommand } from "./telegram.js";
import { habitatCommand } from "./habitat.js";
import { mcpCommand } from "./mcp.js";
import { knowledgeCommand } from "./knowledge.js";

// Get the version from package.json. Try both the dist layout
// (packages/cli/dist/cli.js → ../package.json) and the src layout
// (packages/cli/src/cli.ts → ../package.json under tsx).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let packageJson: { version: string };
try {
	packageJson = JSON.parse(
		readFileSync(join(__dirname, "../package.json"), "utf8"),
	);
} catch {
	try {
		packageJson = JSON.parse(
			readFileSync(join(__dirname, "../../package.json"), "utf8"),
		);
	} catch {
		packageJson = { version: "0.0.0" };
	}
}

const program = new Command();

program
	.name("umwelten")
	.description("CLI tool for evaluating language models")
	.version(packageJson.version);

// Add commands
program.addCommand(modelsCommand);
program.addCommand(runCommand);
program.addCommand(chatCommand);
program.addCommand(sessionsCommand);
// Attach `sessions habitat <cmd>` here so @umwelten/sessions doesn't have to
// depend on @umwelten/habitat (sessions-habitat lives in the habitat package
// because it uses Habitat-specific APIs).
registerSessionsHabitatCommands(sessionsCommand);
program.addCommand(telegramCommand);
program.addCommand(habitatCommand);
program.addCommand(mcpCommand);
program.addCommand(introspectCommand);
program.addCommand(browseCommand);
program.addCommand(knowledgeCommand);
addToolsCommand(program);

program.parse();
