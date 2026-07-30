import { describe, expect, it, vi } from "vitest";
import type { Tool } from "ai";
import {
	assertToolAllowed,
	filterToolsForScope,
	getCallerScope,
	guardTool,
	isReadOnlyTool,
	READ_ONLY_TOOLS,
	ReadOnlyToolError,
	runWithCallerScope,
} from "./caller-scope.js";

const READONLY = { principal: "readonly-bearer", readOnly: true };
const OPERATOR = { principal: "bearer-user", readOnly: false };

const tool = (execute: unknown = vi.fn()) => ({ execute }) as unknown as Tool;

describe("isReadOnlyTool", () => {
	it("allows the listed read tools", () => {
		expect(isReadOnlyTool("list_habitats")).toBe(true);
		expect(isReadOnlyTool("habitat_status")).toBe(true);
	});

	/**
	 * The whole point of an allowlist: a tool added next week is refused until
	 * someone looks at it. Getting this backwards fails open.
	 */
	it("refuses anything unlisted, including tools that do not exist yet", () => {
		expect(isReadOnlyTool("remove_habitat")).toBe(false);
		expect(isReadOnlyTool("set_secret")).toBe(false);
		expect(isReadOnlyTool("a_tool_invented_after_this_list")).toBe(false);
	});

	/**
	 * Asking a habitat a question makes it think, act and spend money. It reads
	 * to a human like a query, which is exactly why it is called out here.
	 */
	it("refuses ask_habitat despite it sounding like a read", () => {
		expect(isReadOnlyTool("ask_habitat")).toBe(false);
		expect(READ_ONLY_TOOLS).not.toContain("ask_habitat");
	});
});

describe("runWithCallerScope", () => {
	it("exposes the scope to everything inside, including after an await", async () => {
		await runWithCallerScope(READONLY, async () => {
			expect(getCallerScope()).toEqual(READONLY);
			await Promise.resolve();
			expect(getCallerScope()?.readOnly).toBe(true);
		});
	});

	it("leaves no scope behind", async () => {
		await runWithCallerScope(READONLY, async () => {});
		expect(getCallerScope()).toBeUndefined();
	});
});

describe("filterToolsForScope", () => {
	const tools = {
		list_habitats: tool(),
		remove_habitat: tool(),
	};

	it("hides write tools from a read-only caller", () => {
		const filtered = filterToolsForScope(tools, READONLY);
		expect(Object.keys(filtered)).toEqual(["list_habitats"]);
	});

	/** Every existing caller must be untouched by this. */
	it("passes everything through for an operator and for no scope at all", () => {
		expect(filterToolsForScope(tools, OPERATOR)).toBe(tools);
		expect(filterToolsForScope(tools, undefined)).toBe(tools);
	});

	it("reads the ambient scope when none is passed", () => {
		runWithCallerScope(READONLY, () => {
			expect(Object.keys(filterToolsForScope(tools))).toEqual(["list_habitats"]);
		});
	});
});

describe("guardTool", () => {
	/**
	 * The load-bearing case: a habitat caches its assembled Stimulus per
	 * channel, so one guarded tool object is reused across callers of different
	 * scopes. The check has to happen when it runs, not when it was built.
	 */
	it("refuses a write tool at call time under a read-only scope", async () => {
		const execute = vi.fn().mockResolvedValue("done");
		const guarded = guardTool("remove_habitat", tool(execute));

		await expect(
			runWithCallerScope(READONLY, async () =>
				(guarded as any).execute({}, {}),
			),
		).rejects.toThrow(ReadOnlyToolError);
		expect(execute).not.toHaveBeenCalled();
	});

	it("lets the same tool object through for an operator", async () => {
		const execute = vi.fn().mockResolvedValue("done");
		const guarded = guardTool("remove_habitat", tool(execute));

		await runWithCallerScope(OPERATOR, async () =>
			(guarded as any).execute({ id: "x" }, {}),
		);
		expect(execute).toHaveBeenCalledWith({ id: "x" }, {});
	});

	it("allows an allowlisted tool under a read-only scope", async () => {
		const execute = vi.fn().mockResolvedValue("ok");
		const guarded = guardTool("list_habitats", tool(execute));

		await expect(
			runWithCallerScope(READONLY, async () =>
				(guarded as any).execute({}, {}),
			),
		).resolves.toBe("ok");
	});

	it("is inert outside any scope, which is every path today", async () => {
		const execute = vi.fn().mockResolvedValue("ok");
		const guarded = guardTool("remove_habitat", tool(execute));

		await expect((guarded as any).execute({}, {})).resolves.toBe("ok");
	});

	it("passes through a tool with nothing to intercept", () => {
		const clientSide = { description: "no execute" } as unknown as Tool;
		expect(guardTool("whatever", clientSide)).toBe(clientSide);
	});

	it("preserves the tool's other properties", () => {
		const original = {
			description: "d",
			inputSchema: { k: 1 },
			execute: vi.fn(),
		} as unknown as Tool;
		const guarded = guardTool("list_habitats", original) as any;
		expect(guarded.description).toBe("d");
		expect(guarded.inputSchema).toEqual({ k: 1 });
	});
});

describe("assertToolAllowed", () => {
	it("explains what the credential can and cannot do", () => {
		runWithCallerScope(READONLY, () => {
			try {
				assertToolAllowed("remove_habitat");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ReadOnlyToolError);
				expect((err as Error).message).toContain("remove_habitat");
				expect((err as Error).message).toContain("read-only");
				expect((err as Error).message).toContain("cannot start, stop");
			}
		});
	});

	it("does nothing without a scope", () => {
		expect(() => assertToolAllowed("remove_habitat")).not.toThrow();
	});
});
