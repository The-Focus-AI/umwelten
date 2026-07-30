/**
 * What the current caller is allowed to do (#165 groundwork).
 *
 * A habitat's A2A surface has exactly two credentials today: a per-user JWT,
 * and one shared bearer that is the full operator key. There is nothing in
 * between — so handing anyone a credential hands them `remove_habitat`,
 * `set_secret` and the ability to cycle the fleet, whether they need it or not.
 *
 * That is the wrong shape for the common case, which is *watching*: reading
 * status, listing habitats, tailing logs. This adds a second bearer that
 * authenticates to a **read-only** scope, and a default-deny allowlist that
 * decides which tools such a caller can see at all.
 *
 * Two deliberate choices:
 *
 *  - **Default deny.** The allowlist names what a read-only caller *may* call;
 *    anything unlisted is refused, including tools added later. Classifying 76
 *    existing tools as read-or-write and getting one wrong fails open, which
 *    is exactly the mistake this exists to prevent.
 *
 *  - **Filtered, not just refused.** A restricted caller never sees a
 *    forbidden tool in its toolset, so the model does not try, fail, and
 *    narrate the failure. The runtime guard stays as a backstop for any path
 *    that assembles tools some other way.
 *
 * Carried in AsyncLocalStorage rather than threaded through every signature,
 * the same pattern as the speaker context next door.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Tool } from "ai";

export interface CallerScope {
	/** How this caller authenticated, for logs. Never a credential. */
	principal: string;
	/**
	 * True when the caller may only invoke allowlisted read tools. False for
	 * the operator bearer and for per-user JWTs, which are unchanged.
	 */
	readOnly: boolean;
}

const storage = new AsyncLocalStorage<CallerScope>();

export function runWithCallerScope<T>(scope: CallerScope, fn: () => T): T {
	return storage.run(scope, fn);
}

/** The current caller's scope, or undefined outside a scoped request. */
export function getCallerScope(): CallerScope | undefined {
	return storage.getStore();
}

/**
 * Tools a read-only caller may invoke.
 *
 * Everything here answers a question without changing anything: no container
 * lifecycle, no secret writes, no registry mutation, no repo writes, and
 * nothing that sends a message onward to another agent — asking a habitat a
 * question makes it *do* things, and can spend money.
 *
 * `ask_habitat` is deliberately absent for that reason, even though it reads
 * to a human like a query.
 */
export const READ_ONLY_TOOLS: readonly string[] = [
	// Fleet state
	"list_habitats",
	"habitat_status",
	"habitat_logs",
	"discover_habitats",
	// Secrets — names and satisfaction only; no tool here returns a value
	"secret_status",
	"list_secrets",
	"plan_vault_migration",
	// Catalogue
	"list_models",
	"list_credentials",
	"credential_audit_log",
	// Sessions
	"sessions_list",
	"sessions_show",
	"sessions_messages",
	"sessions_stats",
	"current_time",
];

const readOnly = new Set(READ_ONLY_TOOLS);

/** True when `name` is safe for a read-only caller. Default deny. */
export function isReadOnlyTool(name: string): boolean {
	return readOnly.has(name);
}

/**
 * Narrow a toolset to what the current caller may use.
 *
 * Unscoped callers (no ALS store) get everything — that is every existing
 * path, including the operator bearer and per-user JWTs, so this changes
 * nothing until a read-only credential is actually configured and used.
 */
export function filterToolsForScope(
	tools: Record<string, Tool>,
	scope: CallerScope | undefined = getCallerScope(),
): Record<string, Tool> {
	if (!scope?.readOnly) return tools;

	const allowed: Record<string, Tool> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (isReadOnlyTool(name)) allowed[name] = tool;
	}
	return allowed;
}

/**
 * Wrap a tool so it refuses at *call* time when the caller is read-only.
 *
 * Filtering alone is not enough here, because a habitat caches its assembled
 * Stimulus per channel — the toolset outlives the request that built it, so a
 * set filtered for one caller would be reused for the next. The check has to
 * read the scope when the tool actually runs, which is what this does; the
 * filter above is then a UX nicety (don't show the model a door it can't open)
 * rather than the thing holding the line.
 *
 * Applied once in {@link ToolRegistry.addTool}, so it covers every surface —
 * A2A, MCP, web chat, Discord, sub-agents — without each having to remember.
 */
export function guardTool(name: string, tool: Tool): Tool {
	const execute = (tool as { execute?: unknown }).execute;
	// Client-side / provider-executed tools have nothing to intercept.
	if (typeof execute !== "function") return tool;

	return {
		...tool,
		execute: (...args: unknown[]) => {
			assertToolAllowed(name);
			return (execute as (...a: unknown[]) => unknown)(...args);
		},
	} as Tool;
}

export class ReadOnlyToolError extends Error {
	constructor(readonly toolName: string) {
		super(
			`"${toolName}" is not available to a read-only caller. This credential can read fleet state and secret status; it cannot start, stop, rebuild, configure or message anything.`,
		);
		this.name = "ReadOnlyToolError";
	}
}

/**
 * Backstop for any path that assembles tools without going through
 * {@link filterToolsForScope}. Cheap, and the difference between a bug being
 * a refusal and being a fleet mutation.
 */
export function assertToolAllowed(name: string): void {
	const scope = getCallerScope();
	if (scope?.readOnly && !isReadOnlyTool(name)) {
		throw new ReadOnlyToolError(name);
	}
}
