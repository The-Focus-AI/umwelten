/**
 * One vault per habitat, resolved by Gaia (umwelten #283, ADR 0009).
 *
 * A habitat declares what it needs. Its vault says where those values come
 * from. Both live in the habitat's own repo, next to each other, and Gaia
 * executes the vault declaration on the host.
 *
 * That replaces a flat master vault whose keys doubled as environment
 * variable names, so two habitats could never both see `DATABASE_URL` with
 * different values. Per-habitat vaults make the name a *local* fact — every
 * habitat's `DATABASE_URL` is its own — which is how fnox already works for
 * every project in this org, and the reason nothing has to be inferred,
 * defaulted, or renamed to avoid a collision.
 *
 * Two invariants:
 *
 *  - **No vault credential is ever inside a container.** Gaia resolves on the
 *    host and injects values. A container running agent tools against
 *    untrusted input must never hold something that opens a vault.
 *  - **An unresolvable vault fails the start.** Starting a habitat with
 *    values silently missing is what produced a container that boots, passes
 *    its health check, and then fails on its first real question. A habitat
 *    that cannot be configured should not run.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Vault declaration filename, at the root of the habitat's Owned repo. */
export const HABITAT_VAULT_FILE = "fnox.toml";

export class VaultResolutionError extends Error {
	constructor(
		message: string,
		readonly habitatId: string,
	) {
		super(message);
		this.name = "VaultResolutionError";
	}
}

/**
 * The vault tooling itself is absent — fnox is not on this host.
 *
 * Distinguished from a failed resolution because the two want opposite
 * handling. A bad `fnox.toml`, a rejected credential, or a vault that answers
 * with nonsense is a misconfiguration of *this habitat*, and starting it
 * anyway produces the under-configured container `startHabitatContainer`
 * exists to prevent. Missing tooling is a property of the *host*, and it says
 * nothing about whether this habitat needs a secret: a habitat that declares
 * none is blocked by a vault it would never have read.
 *
 * So the caller decides, and it can only decide if it can tell the two apart.
 */
export class VaultToolingMissingError extends VaultResolutionError {
	constructor(message: string, habitatId: string) {
		super(message, habitatId);
		this.name = "VaultToolingMissingError";
	}
}

/** ENOENT from spawning fnox — the binary is not installed, not a vault fault. */
function isMissingTooling(err: unknown): boolean {
	return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export interface VaultResolution {
	/** Resolved name → value. Never logged. */
	secrets: Record<string, string>;
	/** Names only, for audit and for reporting to a human. */
	names: string[];
	/** Which profile was used, when one was asked for. */
	profile?: string;
}

export interface VaultResolveDeps {
	/**
	 * Run `fnox export` in `cwd` and return raw stdout. Injected so the
	 * resolution is testable without fnox, a vault, or a network.
	 */
	exportVault(cwd: string, profile?: string): Promise<string>;
	/** Where per-habitat scratch dirs live (Gaia's data dir). */
	dataDir: string;
	/** Audit sink. Called for success and failure alike. */
	audit?: (event: VaultAuditEvent) => void;
}

export interface VaultAuditEvent {
	habitatId: string;
	ok: boolean;
	/** Names resolved, or [] on failure. Values never appear here. */
	names: string[];
	profile?: string;
	error?: string;
}

/**
 * Resolve a habitat's own vault.
 *
 * The declaration is written to a scratch dir and removed afterwards: fnox
 * resolves relative to a working directory, and leaving the file behind would
 * make the on-disk copy a second source of truth that could drift from the
 * repo.
 */
export async function resolveHabitatVault(
	input: { id: string; vaultToml: string; profile?: string },
	deps: VaultResolveDeps,
): Promise<VaultResolution> {
	const { id, vaultToml, profile } = input;
	const dir = join(deps.dataDir, "habitats", id, "vault");

	const fail = (message: string): never => {
		deps.audit?.({ habitatId: id, ok: false, names: [], profile, error: message });
		throw new VaultResolutionError(message, id);
	};

	let stdout: string;
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, HABITAT_VAULT_FILE), vaultToml, { mode: 0o600 });
		stdout = await deps.exportVault(dir, profile);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (isMissingTooling(err)) {
			const text =
				`Could not resolve the vault for "${id}": fnox is not installed on this host. ` +
				`Gaia brokers every habitat's secrets itself, so fnox belongs on the host, not in the habitat image.`;
			deps.audit?.({ habitatId: id, ok: false, names: [], profile, error: text });
			throw new VaultToolingMissingError(text, id);
		}
		return fail(`Could not resolve the vault for "${id}": ${message}`);
	} finally {
		// Best effort — a leftover declaration is a stale copy, not a secret.
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return fail(
			`The vault for "${id}" did not return JSON. Check ${HABITAT_VAULT_FILE} in its repo.`,
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return fail(`The vault for "${id}" returned ${typeof parsed}, expected an object.`);
	}

	const secrets: Record<string, string> = {};
	for (const [name, value] of Object.entries(parsed)) {
		// A declared-but-empty secret is not a value. Letting it through would
		// reproduce the failure this exists to prevent, one layer down.
		if (typeof value === "string" && value.length > 0) secrets[name] = value;
	}

	const names = Object.keys(secrets);
	deps.audit?.({ habitatId: id, ok: true, names, profile });
	return { secrets, names, ...(profile ? { profile } : {}) };
}

/**
 * Check a habitat's declared needs against what its vault actually resolved.
 *
 * This is the thing that turns "starts and then fails" into "does not start".
 * Returns the names the habitat declared that the vault could not supply.
 */
export function unmetBindings(
	declared: readonly string[],
	resolved: Record<string, string>,
): string[] {
	return declared.filter((name) => !resolved[name]);
}

/** The real fnox invocation. Separated so nothing else shells out. */
export function nodeVaultDeps(dataDir: string, audit?: VaultResolveDeps["audit"]): VaultResolveDeps {
	return {
		dataDir,
		...(audit ? { audit } : {}),
		async exportVault(cwd, profile) {
			const args = ["export", "--format", "json"];
			if (profile) args.push("--profile", profile);
			const { stdout } = await execFileAsync("fnox", args, {
				cwd,
				timeout: 30_000,
			});
			return stdout;
		},
	};
}
