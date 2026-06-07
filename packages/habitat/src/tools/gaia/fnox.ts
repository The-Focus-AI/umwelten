/**
 * fnox Integration — Gaia's secret resolution layer.
 *
 * Gaia resolves its master vault secrets via fnox at container start,
 * with no plaintext secrets baked into the image.
 *
 * In Docker: the entrypoint wraps the serve command with `fnox exec --`.
 * In dev: Gaia shells out to `fnox export --format json` to populate the
 * vault, and falls back to .env / process.env when fnox is not installed.
 *
 * Habitats never call fnox — Gaia is the sole broker.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FNOX_CONFIG_FILE = "fnox.toml";

/** Bootstrap token env vars that operators may pass to the Gaia container. */
export const BOOTSTRAP_TOKEN_ENV_VARS = [
	"OP_SERVICE_ACCOUNT_TOKEN", // 1Password
	"FNOX_AGE_KEY", // age encryption key path
	"FNOX_AGE_KEY_FILE", // age encryption key file
] as const;

/**
 * Template fnox.toml written to Gaia's data dir on first boot if not already
 * present. All secrets are commented out — the operator uncomments and
 * configures the providers they use.
 */
export const FNOX_TEMPLATE = `\
#:schema https://fnox.jdx.dev/schema.json
# fnox.toml — Gaia secret resolution
#
# This file lives in Gaia's data directory and declares the secrets
# Gaia needs to function. Uncomment and configure providers and
# secrets you want fnox to manage.
#
# When fnox is installed and this file is configured, Gaia resolves
# its master vault secrets via fnox at startup. Otherwise, Gaia
# falls back to .env / environment variables (development mode).
#
# Docs: https://fnox.jdx.dev/
# Providers: https://fnox.jdx.dev/providers/overview.html
# Config reference: https://fnox.jdx.dev/reference/configuration.html

if_missing = "warn"

# ── Providers ───────────────────────────────────────────────────────
# Uncomment and configure the provider(s) you use.

# 1Password (set OP_SERVICE_ACCOUNT_TOKEN in the environment)
# [providers.onepass]
# type = "1password"
# vault = "Development"

# Age encryption (file-based, set FNOX_AGE_KEY or FNOX_AGE_KEY_FILE)
# [providers.age]
# type = "age"
# recipients = ["age1..."]

# GCP Secret Manager
# [providers.gcp]
# type = "gcp-sm"
# project = "my-project-id"

# AWS Secrets Manager
# [providers.aws]
# type = "aws-sm"
# region = "us-east-1"

# HashiCorp Vault
# [providers.vault]
# type = "vault"
# address = "https://vault.example.com:8200"
# path = "secret/gaia"

# ── Secrets Gaia needs ──────────────────────────────────────────────
# Uncomment and configure as needed. Replace provider names and
# references with your own.

[secrets]
# GOOGLE_GENERATIVE_AI_API_KEY = { provider = "onepass", description = "Google Gemini API key" }
# OPENROUTER_API_KEY = { provider = "onepass", description = "OpenRouter API key" }
# GITHUB_TOKEN = { provider = "onepass", description = "GitHub personal access token" }
# GITHUB_APP_PRIVATE_KEY = { provider = "onepass", description = "GitHub App private key" }
# GITHUB_APP_ID = { provider = "onepass", description = "GitHub App ID" }
# TAVILY_API_KEY = { provider = "onepass", description = "Tavily search API key" }
`;

/** Details about a bootstrap token found in the environment. */
export interface BootstrapToken {
	/** Env var name (e.g. "OP_SERVICE_ACCOUNT_TOKEN") */
	envVar: string;
	/** Provider it unlocks (e.g. "1password") */
	provider: string;
}

export type FnoxMode = "fnox" | "env" | "none";

export interface FnoxResolutionResult {
	/** How secrets were resolved. */
	mode: FnoxMode;
	/** Resolved secrets (name → value). Empty if mode is "none". */
	secrets: Record<string, string>;
	/** Bootstrap token details, if any. */
	bootstrapToken: BootstrapToken | null;
	/** Diagnostic warnings, if any. */
	warnings: string[];
}

export class FnoxResolver {
	constructor(private readonly dataDir: string) {}

	/** Absolute path to fnox.toml in the data dir. */
	get configPath(): string {
		return join(this.dataDir, FNOX_CONFIG_FILE);
	}

	/** Check if fnox CLI is available on the system. */
	async isAvailable(): Promise<boolean> {
		try {
			await execFileAsync("fnox", ["--version"], { timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	}

	/** Check if fnox.toml exists in the data dir. */
	hasConfig(): boolean {
		return existsSync(this.configPath);
	}

	/**
	 * Write the fnox.toml template if it doesn't already exist.
	 * Returns true if the file was created, false if it already existed.
	 */
	async writeTemplateIfMissing(): Promise<boolean> {
		if (this.hasConfig()) return false;
		await mkdir(this.dataDir, { recursive: true });
		await writeFile(this.configPath, FNOX_TEMPLATE, { mode: 0o644 });
		return true;
	}

	/**
	 * Look for a bootstrap token in the environment.
	 * Returns the first match found, or null if none set.
	 */
	static detectBootstrapToken(): BootstrapToken | null {
		for (const envVar of BOOTSTRAP_TOKEN_ENV_VARS) {
			if (process.env[envVar]) {
				return {
					envVar,
					provider: FnoxResolver.envVarToProvider(envVar),
				};
			}
		}
		return null;
	}

	/** Map a bootstrap token env var to its provider name. */
	private static envVarToProvider(envVar: string): string {
		switch (envVar) {
			case "OP_SERVICE_ACCOUNT_TOKEN":
				return "1password";
			case "FNOX_AGE_KEY":
			case "FNOX_AGE_KEY_FILE":
				return "age";
			default:
				return "unknown";
		}
	}

	/**
	 * Resolve secrets via `fnox export --format json`.
	 *
	 * Spawns fnox with cwd = dataDir (so it finds fnox.toml). Parses the
	 * JSON output into a secret name → value map.
	 *
	 * @throws if fnox is not available, config doesn't exist, or fnox fails.
	 */
	async resolveViaFnox(): Promise<Record<string, string>> {
		if (!this.hasConfig()) {
			throw new Error(
				`fnox.toml not found at ${this.configPath}. Run Gaia once to generate the template, then configure it.`,
			);
		}

		if (!(await this.isAvailable())) {
			throw new Error(
				"fnox CLI not found on PATH. Install fnox: https://fnox.jdx.dev/guide/installation.html",
			);
		}

		const { stdout, stderr } = await execFileAsync(
			"fnox",
			["export", "--format", "json"],
			{ cwd: this.dataDir, timeout: 30_000 },
		);

		if (stderr) {
			// fnox may emit non-fatal warnings on stderr
			console.warn(`[fnox] ${stderr.trim()}`);
		}

		try {
			const parsed: unknown = JSON.parse(stdout);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				throw new Error(
					`fnox export returned unexpected JSON type: ${typeof parsed}`,
				);
			}

			const secrets: Record<string, string> = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string") {
					secrets[key] = value;
				}
			}
			return secrets;
		} catch (err: any) {
			if (err.message.includes("fnox export returned")) throw err;
			throw new Error(
				`Failed to parse fnox export output: ${err.message}\nstdout: ${stdout.slice(0, 200)}`,
				{ cause: err },
			);
		}
	}

	/**
	 * Resolve secrets from environment variables directly.
	 * Reads the secrets declared in fnox.toml and looks them up in process.env.
	 * This is the fallback path when fnox is not installed.
	 */
	async resolveViaEnv(): Promise<Record<string, string>> {
		const secrets: Record<string, string> = {};

		// Try to read the secrets declared in fnox.toml so we know what to look for.
		// If fnox.toml doesn't exist, fall back to a known set of env vars.
		const declaredSecrets = this.hasConfig()
			? await this.readDeclaredSecretsFromToml()
			: FALLBACK_SECRET_NAMES;

		for (const name of declaredSecrets) {
			const val = process.env[name];
			if (val) {
				secrets[name] = val;
			}
		}

		return secrets;
	}

	/**
	 * Parse fnox.toml to extract the declared secret names (not values).
	 * Uses simple line-by-line parsing — robust enough for template files.
	 */
	private async readDeclaredSecretsFromToml(): Promise<string[]> {
		try {
			const content = await readFile(this.configPath, "utf-8");
			const names: string[] = [];
			const lines = content.split("\n");
			let inSecretsSection = false;

			for (const line of lines) {
				const trimmed = line.trim();

				// Track [secrets] section
				if (/^\[secrets\]/.test(trimmed)) {
					inSecretsSection = true;
					continue;
				}

				// Section change
				if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
					inSecretsSection = false;
					continue;
				}

				// Inside [secrets], look for KEY = { ... } (commented or not)
				if (inSecretsSection) {
					// Match both commented and uncommented secret declarations
					const match = trimmed.match(/^#?\s*([A-Z_][A-Z0-9_]*)\s*=\s*\{/);
					if (match?.[1]) {
						names.push(match[1]);
					}
				}
			}

			return names;
		} catch {
			return [];
		}
	}

	/**
	 * Full secret resolution flow:
	 *
	 * 1. Try fnox (if installed + fnox.toml configured)
	 * 2. Fall back to env vars
	 *
	 * Never throws — returns the mode and any resolved secrets.
	 */
	async resolve(): Promise<FnoxResolutionResult> {
		const warnings: string[] = [];
		const bootstrapToken = FnoxResolver.detectBootstrapToken();

		// Try fnox first
		if (this.hasConfig() && (await this.isAvailable())) {
			try {
				const secrets = await this.resolveViaFnox();
				return {
					mode: "fnox",
					secrets,
					bootstrapToken,
					warnings,
				};
			} catch (err: any) {
				warnings.push(`fnox resolution failed: ${err.message}`);
				console.warn(
					`[gaia] fnox resolution failed, falling back to env vars: ${err.message}`,
				);
			}
		}

		// Fall back to env vars
		const secrets = await this.resolveViaEnv();
		if (Object.keys(secrets).length > 0) {
			return {
				mode: "env",
				secrets,
				bootstrapToken,
				warnings,
			};
		}

		// No secrets at all
		warnings.push(
			"No secrets resolved (neither fnox nor env vars). " +
				"Gaia will start but may not be able to call LLM providers.",
		);
		return {
			mode: "none",
			secrets: {},
			bootstrapToken,
			warnings,
		};
	}
}

/**
 * Fallback secret names to check in process.env when fnox.toml
 * is not present and we're in dev mode.
 */
const FALLBACK_SECRET_NAMES = [
	"GOOGLE_GENERATIVE_AI_API_KEY",
	"OPENROUTER_API_KEY",
	"GITHUB_TOKEN",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_ID",
	"TAVILY_API_KEY",
];
