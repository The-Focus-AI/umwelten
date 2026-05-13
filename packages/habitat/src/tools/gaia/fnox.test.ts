/**
 * Unit tests for FnoxResolver — mocked fnox CLI, no real fnox needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	FnoxResolver,
	FNOX_TEMPLATE,
	BOOTSTRAP_TOKEN_ENV_VARS,
	type BootstrapToken,
} from "./fnox.js";

// We mock execFile at the module level. The function we return must match
// the callback-based signature that promisify() expects:
//   execFile(cmd, args?, options?, callback)
//
// The callback is always the last argument.

type CallbackFn = (
	error: Error | null,
	result: { stdout: string; stderr: string },
) => void;

let mockImpl: (
	cmd: string,
	args: string[],
	options: Record<string, unknown>,
	cb: CallbackFn,
) => void = () => {};

vi.mock("node:child_process", async () => {
	const actual = await vi.importActual("node:child_process");
	return {
		...actual,
		execFile: vi
			.fn()
			.mockImplementation(
				(
					cmd: string,
					args?: string[] | CallbackFn,
					options?: Record<string, unknown> | CallbackFn,
					cb?: CallbackFn,
				) => {
					// Resolve the callback from the various overloads
					let callback: CallbackFn | undefined;
					if (typeof args === "function") {
						callback = args;
					} else if (typeof options === "function") {
						callback = options;
					} else {
						callback = cb;
					}
					if (callback) {
						mockImpl(
							cmd,
							Array.isArray(args) ? args : [],
							typeof options === "object" && options !== null
								? (options as Record<string, unknown>)
								: {},
							callback,
						);
					}
					return {} as any; // ChildProcess stub
				},
			),
	};
});

function setMockImpl(
	fn: (
		cmd: string,
		args: string[],
		options: Record<string, unknown>,
		cb: CallbackFn,
	) => void,
): void {
	mockImpl = fn;
}

/** Fake fnox --version success response. */
function mockFnoxAvailable(): void {
	setMockImpl((cmd, args, _opts, cb) => {
		if (cmd === "fnox" && args.includes("--version")) {
			cb(null, { stdout: "fnox 1.24.0", stderr: "" });
		} else {
			cb(new Error(`unexpected: ${cmd} ${args.join(" ")}`), {
				stdout: "",
				stderr: "",
			});
		}
	});
}

/** Fake fnox not found. */
function mockFnoxUnavailable(): void {
	setMockImpl((cmd, _args, _opts, cb) => {
		if (cmd === "fnox") {
			cb(new Error("ENOENT: fnox not found"), { stdout: "", stderr: "" });
		} else {
			cb(null, { stdout: "", stderr: "" });
		}
	});
}

/** Fake fnox export --format json output (also responds to --version). */
function mockFnoxExport(secrets: Record<string, string>): void {
	setMockImpl((cmd, args, _opts, cb) => {
		if (cmd === "fnox" && args.includes("--version")) {
			cb(null, { stdout: "fnox 1.24.0", stderr: "" });
		} else if (cmd === "fnox" && args.includes("export")) {
			cb(null, {
				stdout: JSON.stringify(secrets, null, 2),
				stderr: "",
			});
		} else {
			cb(new Error(`unexpected: ${cmd} ${args.join(" ")}`), {
				stdout: "",
				stderr: "",
			});
		}
	});
}

/** Fake fnox export failure (but --version works). */
function mockFnoxExportFailure(message: string): void {
	setMockImpl((cmd, args, _opts, cb) => {
		if (cmd === "fnox" && args.includes("--version")) {
			cb(null, { stdout: "fnox 1.24.0", stderr: "" });
		} else if (cmd === "fnox" && args.includes("export")) {
			cb(new Error(message), { stdout: "", stderr: message });
		} else {
			cb(new Error(`unexpected: ${cmd}`), { stdout: "", stderr: "" });
		}
	});
}

describe("FnoxResolver", () => {
	let dataDir: string;
	let resolver: FnoxResolver;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "fnox-"));
		resolver = new FnoxResolver(dataDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(dataDir, { recursive: true, force: true });
	});

	// ── isAvailable ────────────────────────────────────────────────────

	it("isAvailable returns true when fnox is on PATH", async () => {
		mockFnoxAvailable();
		expect(await resolver.isAvailable()).toBe(true);
	});

	it("isAvailable returns false when fnox is not installed", async () => {
		mockFnoxUnavailable();
		expect(await resolver.isAvailable()).toBe(false);
	});

	// ── hasConfig / writeTemplateIfMissing ─────────────────────────────

	it("hasConfig returns false before template is written", () => {
		expect(resolver.hasConfig()).toBe(false);
	});

	it("writeTemplateIfMissing writes the template and returns true", async () => {
		const created = await resolver.writeTemplateIfMissing();
		expect(created).toBe(true);
		expect(resolver.hasConfig()).toBe(true);
	});

	it("writeTemplateIfMissing returns false when fnox.toml already exists", async () => {
		await resolver.writeTemplateIfMissing();
		const createdAgain = await resolver.writeTemplateIfMissing();
		expect(createdAgain).toBe(false);
	});

	it("template contains key sections", async () => {
		await resolver.writeTemplateIfMissing();
		const content = FNOX_TEMPLATE;
		expect(content).toContain("fnox.toml");
		expect(content).toContain("if_missing");
		expect(content).toContain("[providers.");
		expect(content).toContain("[secrets]");
		expect(content).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
		expect(content).toContain("OPENROUTER_API_KEY");
		expect(content).toContain("1password");
		expect(content).toContain("age");
	});

	// ── detectBootstrapToken ───────────────────────────────────────────

	it("detectBootstrapToken returns null when no token is set", () => {
		for (const envVar of BOOTSTRAP_TOKEN_ENV_VARS) {
			delete process.env[envVar];
		}
		expect(FnoxResolver.detectBootstrapToken()).toBeNull();
	});

	it("detectBootstrapToken finds OP_SERVICE_ACCOUNT_TOKEN", () => {
		process.env.OP_SERVICE_ACCOUNT_TOKEN = "test-token";
		const token = FnoxResolver.detectBootstrapToken();
		expect(token).toEqual({
			envVar: "OP_SERVICE_ACCOUNT_TOKEN",
			provider: "1password",
		} as BootstrapToken);
		delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
	});

	it("detectBootstrapToken finds FNOX_AGE_KEY", () => {
		process.env.FNOX_AGE_KEY = "/path/to/key";
		const token = FnoxResolver.detectBootstrapToken();
		expect(token).toEqual({
			envVar: "FNOX_AGE_KEY",
			provider: "age",
		} as BootstrapToken);
		delete process.env.FNOX_AGE_KEY;
	});

	it("detectBootstrapToken finds FNOX_AGE_KEY_FILE", () => {
		process.env.FNOX_AGE_KEY_FILE = "/path/to/key.txt";
		const token = FnoxResolver.detectBootstrapToken();
		expect(token).toEqual({
			envVar: "FNOX_AGE_KEY_FILE",
			provider: "age",
		} as BootstrapToken);
		delete process.env.FNOX_AGE_KEY_FILE;
	});

	// ── resolveViaFnox ─────────────────────────────────────────────────

	it("resolveViaFnox returns resolved secrets from fnox export JSON", async () => {
		await resolver.writeTemplateIfMissing();
		mockFnoxExport({
			GOOGLE_GENERATIVE_AI_API_KEY: "google-key-123",
			OPENROUTER_API_KEY: "openrouter-key-456",
		});

		const secrets = await resolver.resolveViaFnox();
		expect(secrets).toEqual({
			GOOGLE_GENERATIVE_AI_API_KEY: "google-key-123",
			OPENROUTER_API_KEY: "openrouter-key-456",
		});
	});

	it("resolveViaFnox throws when fnox.toml does not exist", async () => {
		mockFnoxAvailable();
		await expect(resolver.resolveViaFnox()).rejects.toThrow(
			"fnox.toml not found",
		);
	});

	it("resolveViaFnox throws when fnox is not installed", async () => {
		await resolver.writeTemplateIfMissing();
		mockFnoxUnavailable();
		await expect(resolver.resolveViaFnox()).rejects.toThrow(
			"fnox CLI not found",
		);
	});

	it("resolveViaFnox handles empty secrets object from fnox", async () => {
		await resolver.writeTemplateIfMissing();
		mockFnoxExport({});
		const secrets = await resolver.resolveViaFnox();
		expect(secrets).toEqual({});
	});

	it("resolveViaFnox filters out non-string values from fnox output", async () => {
		await resolver.writeTemplateIfMissing();

		setMockImpl((cmd, args, _opts, cb) => {
			if (cmd === "fnox" && args.includes("--version")) {
				cb(null, { stdout: "fnox 1.24.0", stderr: "" });
			} else if (cmd === "fnox" && args.includes("export")) {
				cb(null, {
					stdout: JSON.stringify({
						STRING_KEY: "a-string",
						NUMBER_KEY: 42,
						NULL_KEY: null,
					}),
					stderr: "",
				});
			} else {
				cb(new Error(`unexpected`), { stdout: "", stderr: "" });
			}
		});

		const secrets = await resolver.resolveViaFnox();
		expect(secrets).toEqual({
			STRING_KEY: "a-string",
		});
	});

	// ── resolveViaEnv ──────────────────────────────────────────────────

	it("resolveViaEnv reads secrets from process.env", async () => {
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "env-google-key";
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";

		const secrets = await resolver.resolveViaEnv();
		expect(secrets.GOOGLE_GENERATIVE_AI_API_KEY).toBe("env-google-key");
		expect(secrets.OPENROUTER_API_KEY).toBe("env-openrouter-key");

		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
	});

	it("resolveViaEnv returns empty object when no secrets are in env", async () => {
		for (const name of [
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"OPENROUTER_API_KEY",
			"GITHUB_TOKEN",
		]) {
			delete process.env[name];
		}

		const secrets = await resolver.resolveViaEnv();
		expect(secrets).toEqual({});
	});

	it("resolveViaEnv reads declared secrets from fnox.toml when present", async () => {
		await writeFile(
			resolver.configPath,
			`\
[secrets]
CUSTOM_KEY = { provider = "age", value = "enc..." }
ANOTHER_KEY = { provider = "onepass" }
`,
		);

		process.env.CUSTOM_KEY = "custom-value";
		process.env.ANOTHER_KEY = "another-value";
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "should-not-appear";

		const secrets = await resolver.resolveViaEnv();
		expect(secrets).toEqual({
			CUSTOM_KEY: "custom-value",
			ANOTHER_KEY: "another-value",
		});

		delete process.env.CUSTOM_KEY;
		delete process.env.ANOTHER_KEY;
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	});

	it("resolveViaEnv parses commented-out secret declarations", async () => {
		// Write the full template which has commented-out secrets
		await writeFile(resolver.configPath, FNOX_TEMPLATE);

		process.env.OPENROUTER_API_KEY = "env-or-key";
		process.env.GITHUB_TOKEN = "env-gh-token";

		const secrets = await resolver.resolveViaEnv();
		// The template has these commented out: OPENROUTER_API_KEY, GITHUB_TOKEN, etc.
		expect(secrets.OPENROUTER_API_KEY).toBe("env-or-key");
		expect(secrets.GITHUB_TOKEN).toBe("env-gh-token");

		delete process.env.OPENROUTER_API_KEY;
		delete process.env.GITHUB_TOKEN;
	});

	// ── resolve (full flow) ────────────────────────────────────────────

	it("resolve returns mode=fnox when fnox is available and configured", async () => {
		await resolver.writeTemplateIfMissing();
		mockFnoxExport({
			GOOGLE_GENERATIVE_AI_API_KEY: "via-fnox",
		});

		const result = await resolver.resolve();
		expect(result.mode).toBe("fnox");
		expect(result.secrets).toEqual({
			GOOGLE_GENERATIVE_AI_API_KEY: "via-fnox",
		});
		expect(result.bootstrapToken).toBeNull();
		expect(result.warnings).toEqual([]);
	});

	it("resolve returns mode=env when fnox is not available but env vars exist", async () => {
		mockFnoxUnavailable();
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "via-env";

		const result = await resolver.resolve();
		expect(result.mode).toBe("env");
		expect(result.secrets.GOOGLE_GENERATIVE_AI_API_KEY).toBe("via-env");

		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	});

	it("resolve returns mode=env when fnox.toml missing but env vars exist", async () => {
		mockFnoxAvailable(); // fnox is available, but no config
		process.env.OPENROUTER_API_KEY = "env-key";

		const result = await resolver.resolve();
		expect(result.mode).toBe("env");
		expect(result.secrets.OPENROUTER_API_KEY).toBe("env-key");

		delete process.env.OPENROUTER_API_KEY;
	});

	it("resolve returns mode=none when no secrets are available", async () => {
		mockFnoxUnavailable();
		for (const name of [
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"OPENROUTER_API_KEY",
			"GITHUB_TOKEN",
			"TAVILY_API_KEY",
		]) {
			delete process.env[name];
		}

		const result = await resolver.resolve();
		expect(result.mode).toBe("none");
		expect(result.secrets).toEqual({});
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("resolve falls back to env when fnox export fails", async () => {
		await resolver.writeTemplateIfMissing();
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fallback-key";

		// fnox is available but export fails
		mockFnoxExportFailure("1Password connection refused");

		const result = await resolver.resolve();
		expect(result.mode).toBe("env");
		expect(result.secrets.GOOGLE_GENERATIVE_AI_API_KEY).toBe("fallback-key");
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("fnox resolution failed");

		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	});

	it("resolve includes bootstrap token when present", async () => {
		mockFnoxUnavailable();
		process.env.OP_SERVICE_ACCOUNT_TOKEN = "test-token";
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "env-key";

		const result = await resolver.resolve();
		expect(result.bootstrapToken).toEqual({
			envVar: "OP_SERVICE_ACCOUNT_TOKEN",
			provider: "1password",
		});

		delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	});

	// ── configPath ─────────────────────────────────────────────────────

	it("configPath resolves to fnox.toml in the data dir", () => {
		expect(resolver.configPath).toBe(join(dataDir, "fnox.toml"));
	});
});
