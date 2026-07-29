/**
 * Applying a habitat's declaration to the registry.
 *
 * The registry entry becomes a materialisation of the declaration plus
 * runtime facts, so it is derived and rebuildable rather than precious
 * (ADR 0006). Applying is idempotent: the same declaration applied twice
 * leaves the same entry, and re-applying a changed one updates the config and
 * re-derives the scopes without touching anything a running container depends
 * on.
 *
 * There is a bootstrap circularity — Gaia must clone the repo to learn the
 * scopes it needs a token to clone with. It is resolved by cloning the Owned
 * repo under ambient read first, then narrowing to the derived list. That
 * ordering is the whole reason `readDeclaration` is injected here rather than
 * done inline: the clone happens under a different credential than everything
 * afterwards.
 */

import type { GaiaHabitatEntry } from "./types.js";
import {
	HABITAT_DECLARATION_FILE,
	HabitatDeclarationError,
	declarationToCreateOptions,
	parseHabitatDeclaration,
	type DeclarationDefaults,
	type HabitatDeclaration,
} from "./declaration.js";
import { mountsToAgentEntries } from "./mounts.js";
import { deriveRepoScopes, mergeDerivedReadScope } from "./repo-scopes.js";
import type { HabitatConfig } from "../../types.js";

/** The registry surface applying needs — narrow, so tests need no real Gaia. */
export interface ApplyRegistry {
	get(id: string): GaiaHabitatEntry | undefined;
	create(
		options: ReturnType<typeof declarationToCreateOptions>,
	): Promise<GaiaHabitatEntry>;
	update(
		id: string,
		updates: Partial<GaiaHabitatEntry>,
	): Promise<GaiaHabitatEntry>;
}

export interface ApplyDeclarationOptions {
	id: string;
	/** The Owned repo — where the declaration was found. */
	gitUrl: string;
	gitBranch?: string;
	/**
	 * Read `habitat.json` from the Owned repo. Clones under ambient read, since
	 * the narrowed scope cannot be known until the declaration is in hand.
	 * Returns undefined when the repo has no declaration.
	 */
	readDeclaration: (
		gitUrl: string,
		gitBranch?: string,
	) => Promise<string | undefined>;
	/**
	 * Fleet policy the declaration inherits when it says nothing: Gaia's own
	 * provider and model, and how to find a provider's key. A client repo
	 * has no opinion about which model reads it.
	 */
	defaults?: DeclarationDefaults;
}

export interface ApplyResult {
	entry: GaiaHabitatEntry;
	/** Whether this created the habitat or updated an existing one. */
	action: "created" | "updated";
	declaration: HabitatDeclaration;
}

/**
 * Read a habitat's declaration and make the registry match it.
 *
 * A repo with no declaration is refused rather than defaulted: a habitat
 * conjured from nothing is exactly the un-reviewed configuration this ticket
 * exists to remove.
 */
export async function applyHabitatDeclaration(
	registry: ApplyRegistry,
	options: ApplyDeclarationOptions,
): Promise<ApplyResult> {
	const source = await options.readDeclaration(
		options.gitUrl,
		options.gitBranch,
	);
	if (source === undefined) {
		throw new HabitatDeclarationError(
			`No ${HABITAT_DECLARATION_FILE} at the root of ${options.gitUrl}. A habitat's environment is declared in its own repo — add one, or create the habitat directly if it is not repo-backed.`,
		);
	}

	const declaration = parseHabitatDeclaration(source);
	const createOptions = declarationToCreateOptions(declaration, {
		id: options.id,
		gitUrl: options.gitUrl,
		...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
		...(options.defaults ? { defaults: options.defaults } : {}),
	});

	const existing = registry.get(options.id);
	if (!existing) {
		return {
			entry: await registry.create(createOptions),
			action: "created",
			declaration,
		};
	}

	// Rebuild the config from the declaration, but keep agents the declaration
	// does not describe — remote-habitat peers and credential-only entries are
	// wired by other paths and are not this file's to delete.
	const mountedAgents = mountsToAgentEntries(declaration.mounts);
	const keptAgents = (existing.config.agents ?? []).filter(
		(a) => (a.kind ?? "repo") !== "repo" || a.mode !== "read",
	);
	const config: HabitatConfig = {
		...existing.config,
		name: createOptions.name,
		defaultProvider: createOptions.provider ?? existing.config.defaultProvider,
		defaultModel: createOptions.model ?? existing.config.defaultModel,
		gitUrl: options.gitUrl,
		...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
		agents: [...keptAgents, ...mountedAgents],
		...(declaration.skillsFromGit
			? { skillsFromGit: declaration.skillsFromGit }
			: {}),
	};

	const entry = await registry.update(options.id, {
		name: createOptions.name,
		config,
		// Use the resolved bindings, not the raw declaration: they include the
		// provider's own key, which the declaration is not required to state.
		// Taking the raw list here would strip that key on every re-apply and
		// silently break a habitat that was working.
		...(createOptions.secretBindings
			? { secretBindings: createOptions.secretBindings }
			: {}),
		// Read is re-derived from what the declaration says to mount, so removing
		// a mount in the repo actually narrows the scope. Write comes only from
		// the declaration and is never derived.
		github: mergeDerivedReadScope(
			{
				...(declaration.github?.read !== undefined
					? { read: declaration.github.read }
					: {}),
				...(declaration.github?.write !== undefined
					? { write: declaration.github.write }
					: {}),
			},
			deriveRepoScopes(config),
		),
		...(declaration.storage ? { storage: declaration.storage } : {}),
		...(declaration.image ? { image: declaration.image } : {}),
		...(declaration.hostname ? { hostname: declaration.hostname } : {}),
	} as Partial<GaiaHabitatEntry>);

	return { entry, action: "updated", declaration };
}
