import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	helpCommand,
	resetCommand,
	historyCommand,
	exitCommand,
	statsCommand,
	infoCommand,
	toggleStatsCommand,
	getDefaultCommands,
	getChatCommands,
	getAgentCommands,
	getEvaluationCommands,
} from "./DefaultCommands.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";

describe("DefaultCommands", () => {
	let testInteraction: Interaction;
	let consoleSpy: any;
	let logOutput: string[];

	beforeEach(() => {
		testInteraction = new Interaction(
			{ name: "test-model", provider: "test" as const },
			new Stimulus({ role: "test assistant" }),
		);
		logOutput = [];
		consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
			logOutput.push(args.join(" "));
		});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	describe("Command Structure", () => {
		it("should have correct trigger and description for help command", () => {
			expect(helpCommand.trigger).toBe("/?");
			expect(helpCommand.description).toBe("Show this help message");
			expect(typeof helpCommand.execute).toBe("function");
		});

		it("should have correct trigger and description for reset command", () => {
			expect(resetCommand.trigger).toBe("/reset");
			expect(resetCommand.description).toBe("Clear the conversation history");
			expect(typeof resetCommand.execute).toBe("function");
		});

		it("should have correct trigger and description for history command", () => {
			expect(historyCommand.trigger).toBe("/history");
			expect(historyCommand.description).toBe("Show chat message history");
			expect(typeof historyCommand.execute).toBe("function");
		});

		it("should have correct trigger and description for exit command", () => {
			expect(exitCommand.trigger).toBe("/exit");
			expect(exitCommand.description).toBe("End the current session");
			expect(typeof exitCommand.execute).toBe("function");
		});
	});

	describe("Command Execution", () => {
		it("should execute reset command and clear context", async () => {
			testInteraction.addMessage({ role: "user", content: "Hello" });
			expect(testInteraction.getMessages()).toHaveLength(2);

			await resetCommand.execute(testInteraction);

			expect(testInteraction.getMessages()).toHaveLength(0);
			expect(logOutput).toContain("Conversation history cleared.");
		});

		it("should execute history command and show messages", async () => {
			testInteraction.addMessage({ role: "user", content: "Hello" });
			testInteraction.addMessage({ role: "assistant", content: "Hi there!" });

			await historyCommand.execute(testInteraction);

			expect(logOutput).toContain("Conversation history:");
			expect(logOutput).toContain("user: Hello");
			expect(logOutput).toContain("assistant: Hi there!");
		});

		it("should handle empty history in history command", async () => {
			await historyCommand.execute(testInteraction);

			expect(logOutput).toContain("Conversation history:");
			expect(logOutput).toContain("No messages in history.");
		});
	});

	describe("Command Collections", () => {
		it("should return all default commands", () => {
			const commands = getDefaultCommands();
			expect(commands).toHaveLength(7);
			expect(commands).toContain(helpCommand);
			expect(commands).toContain(resetCommand);
			expect(commands).toContain(historyCommand);
			expect(commands).toContain(statsCommand);
			expect(commands).toContain(infoCommand);
			expect(commands).toContain(toggleStatsCommand);
			expect(commands).toContain(exitCommand);
		});

		it("should return chat-specific commands", () => {
			const commands = getChatCommands();
			expect(commands).toHaveLength(7);
			expect(commands).toContain(helpCommand);
			expect(commands).toContain(resetCommand);
			expect(commands).toContain(historyCommand);
			expect(commands).toContain(statsCommand);
			expect(commands).toContain(infoCommand);
			expect(commands).toContain(toggleStatsCommand);
			expect(commands).toContain(exitCommand);
		});

		it("should return agent-specific commands", () => {
			const commands = getAgentCommands();
			expect(commands).toHaveLength(7);
			expect(commands).toContain(helpCommand);
			expect(commands).toContain(resetCommand);
			expect(commands).toContain(historyCommand);
			expect(commands).toContain(statsCommand);
			expect(commands).toContain(infoCommand);
			expect(commands).toContain(toggleStatsCommand);
			expect(commands).toContain(exitCommand);
		});

		it("should return evaluation-specific commands", () => {
			const commands = getEvaluationCommands();
			expect(commands).toHaveLength(4);
			expect(commands).toContain(helpCommand);
			expect(commands).toContain(statsCommand);
			expect(commands).toContain(infoCommand);
			expect(commands).toContain(exitCommand);
		});
	});
});
