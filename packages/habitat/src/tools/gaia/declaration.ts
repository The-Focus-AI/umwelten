/**
 * A habitat's environment, declared in its own repo.
 *
 * Per ADR 0006 the habitat's repo is the source of truth for what the habitat
 * *is* — its Owned repo, its Mounted repos, its model, the credentials it
 * needs. Gaia *applies* that declaration; the registry entry becomes a
 * materialisation of it plus runtime facts (assigned port, container status,
 * cached card), which are derived and rebuildable rather than precious.
 *
 * This is the "build an environment" primitive: creating a client habitat
 * instantiates from a template repo, and every later change is a pull request
 * against that repo rather than a Gaia tool call. The accepted trade is
 * better provenance for worse ergonomics.
 *
 * A `habitat.json` at the repo root looks like:
 *
 *   {
 *     "name": "UpperHand",
 *     "provider": "google",
 *     "model": "gemini-3-flash-preview",
 *     "mounts": [{ "gitRemote": "https://github.com/The-Focus-AI/uh-api.git" }],
 *     "secretBindings": ["GOOGLE_GENERATIVE_AI_API_KEY"],
 *     "github": { "write": ["client-upperhand"] }
 *   }
 *
 * The Owned repo is deliberately absent: it is the repo the declaration lives
 * in, so writing it down would create a second place for it to be wrong.
 */

import type { CreateHabitatOptions, GaiaHabitatEntry, MountedRepoSpec } from "./types.js";

/** Filename Gaia looks for at the root of a habitat's Owned repo. */
export const HABITAT_DECLARATION_FILE = "habitat.json";

export interface HabitatDeclaration {
	name?: string;
	provider?: string;
	model?: string;
	/** Repos this habitat reads and never writes. */
	mounts?: MountedRepoSpec[];
	secretBindings?: string[];
	skillsFromGit?: string[];
	/**
	 * GitHub capabilities. Only `write` is meaningful here — `read` is derived
	 * from the Owned repo plus the mounts (ADR 0006), so declaring it is at
	 * best redundant and at worst a second place to drift.
	 */
	github?: { write?: string[]; read?: "org" | string[] };
	storage?: GaiaHabitatEntry["storage"];
	image?: string;
	hostname?: string;
}

export class HabitatDeclarationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HabitatDeclarationError";
	}
}

function fail(what: string): never {
	throw new HabitatDeclarationError(
		`Invalid ${HABITAT_DECLARATION_FILE}: ${what}`,
	);
}

function asStringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
		fail(`"${field}" must be an array of strings.`);
	}
	return value as string[];
}

function parseMounts(value: unknown): MountedRepoSpec[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) fail(`"mounts" must be an array.`);

	return value.map((raw, i) => {
		if (typeof raw !== "object" || raw === null) {
			fail(`mounts[${i}] must be an object.`);
		}
		const m = raw as Record<string, unknown>;
		if (typeof m.gitRemote !== "string" || !m.gitRemote.trim()) {
			fail(`mounts[${i}] needs a non-empty "gitRemote".`);
		}
		for (const key of ["gitBranch", "id", "name"] as const) {
			if (m[key] !== undefined && typeof m[key] !== "string") {
				fail(`mounts[${i}].${key} must be a string.`);
			}
		}
		return {
			gitRemote: m.gitRemote,
			...(m.gitBranch ? { gitBranch: m.gitBranch as string } : {}),
			...(m.id ? { id: m.id as string } : {}),
			...(m.name ? { name: m.name as string } : {}),
		};
	});
}

/**
 * Parse and validate a declaration.
 *
 * Rejects rather than repairs. A partially understood declaration would
 * produce a partially configured habitat, which fails later and further from
 * the cause than a rejected apply does.
 */
export function parseHabitatDeclaration(source: string): HabitatDeclaration {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (err) {
		fail(`not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		fail("expected a JSON object at the top level.");
	}

	const d = raw as Record<string, unknown>;
	for (const key of ["name", "provider", "model", "image", "hostname"] as const) {
		if (d[key] !== undefined && typeof d[key] !== "string") {
			fail(`"${key}" must be a string.`);
		}
	}

	if (d.gitUrl !== undefined) {
		// The Owned repo is the repo this file lives in. Declaring it here would
		// be a second place for it to be wrong.
		fail(
			`"gitUrl" is not declared here — the Owned repo is the repo this file lives in.`,
		);
	}

	let github: HabitatDeclaration["github"];
	if (d.github !== undefined) {
		if (typeof d.github !== "object" || d.github === null) {
			fail(`"github" must be an object.`);
		}
		const g = d.github as Record<string, unknown>;
		const write = asStringArray(g.write, "github.write");
		const read =
			g.read === "org" ? ("org" as const) : asStringArray(g.read, "github.read");
		github = { ...(write ? { write } : {}), ...(read ? { read } : {}) };
	}

	return {
		...(d.name ? { name: d.name as string } : {}),
		...(d.provider ? { provider: d.provider as string } : {}),
		...(d.model ? { model: d.model as string } : {}),
		...(d.image ? { image: d.image as string } : {}),
		...(d.hostname ? { hostname: d.hostname as string } : {}),
		...(parseMounts(d.mounts) ? { mounts: parseMounts(d.mounts) } : {}),
		...(asStringArray(d.secretBindings, "secretBindings")
			? { secretBindings: asStringArray(d.secretBindings, "secretBindings") }
			: {}),
		...(asStringArray(d.skillsFromGit, "skillsFromGit")
			? { skillsFromGit: asStringArray(d.skillsFromGit, "skillsFromGit") }
			: {}),
		...(github ? { github } : {}),
		...(d.storage ? { storage: d.storage as GaiaHabitatEntry["storage"] } : {}),
	};
}

/**
 * Turn a declaration into creation options.
 *
 * `id` and `gitUrl` come from outside the declaration — the id is how the
 * fleet addresses this habitat and the Owned repo is where the declaration
 * was found, so neither is the declaration's to state.
 */
export function declarationToCreateOptions(
	declaration: HabitatDeclaration,
	context: { id: string; gitUrl: string; gitBranch?: string },
): CreateHabitatOptions {
	return {
		id: context.id,
		name: declaration.name ?? context.id,
		gitUrl: context.gitUrl,
		...(context.gitBranch ? { gitBranch: context.gitBranch } : {}),
		...(declaration.provider ? { provider: declaration.provider } : {}),
		...(declaration.model ? { model: declaration.model } : {}),
		...(declaration.mounts ? { mounts: declaration.mounts } : {}),
		...(declaration.secretBindings
			? { secretBindings: declaration.secretBindings }
			: {}),
		...(declaration.skillsFromGit
			? { skillsFromGit: declaration.skillsFromGit }
			: {}),
		...(declaration.github ? { github: declaration.github } : {}),
		...(declaration.storage ? { storage: declaration.storage } : {}),
		...(declaration.image ? { image: declaration.image } : {}),
		...(declaration.hostname ? { hostname: declaration.hostname } : {}),
	};
}

/**
 * Runtime facts a registry entry holds that no declaration can state.
 *
 * Re-applying a declaration must not disturb these — an apply is a config
 * change, not a restart, and clobbering the port or the API key would take a
 * running container down for no reason.
 */
export const RUNTIME_ONLY_FIELDS = [
	"apiKey",
	"containerPort",
	"cachedCard",
	"createdAt",
] as const;
