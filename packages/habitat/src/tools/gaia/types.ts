/**
 * Types for the Gaia Orchestrator — manages multiple habitat containers.
 */

import type { AgentCardSummary } from "@umwelten/protocols";
import type { HabitatConfig, CapabilityBinding } from "../../types.js";

/** A registered habitat managed by Gaia. */
export interface GaiaHabitatEntry {
	/** Slug identifier, e.g. "jeeves-bot" */
	id: string;
	/** Display name, e.g. "Jeeves Bot" */
	name: string;
	/** Habitat config (reuses existing type) */
	config: HabitatConfig;
	/** Which master secrets this container gets (env var names, not values) */
	secretBindings: string[];
	/** Auto-generated per-container API key */
	apiKey: string;
	/**
	 * Docker image this habitat's container runs.
	 * Omitted ⇒ the default habitat image. Specialized images (coding agent,
	 * packaged Oura/Twitter agents) are built out of band.
	 */
	image?: string;
	/** Assigned host port (127.0.0.1 only) — set after container starts */
	containerPort?: number;
	/**
	 * Public hostname this habitat is served at via the label-driven Caddy
	 * proxy (#170), e.g. "twitter.example.com". Omitted ⇒ derived from
	 * `<id>.$GAIA_BASE_DOMAIN` at start time, or no Caddy label when neither
	 * is set (local dev).
	 */
	hostname?: string;
	/**
	 * Declared GitHub capabilities (ADR 0004) — the boundary both the boot
	 * injection and the token mint route enforce; a habitat can only obtain
	 * tokens covering what it declares here. Repo NAMES only (owner implied
	 * by the App installation).
	 *
	 * - `read: "org"` — ambient read across the whole installation
	 *   (contents: read, repo list omitted at mint time).
	 * - `read: [...]` — explicit read-list (own repo + standards + declared
	 *   needs).
	 * - `write: [...]` — contents/issues/pull_requests write, scoped to
	 *   exactly these repos. Branches + PRs only in practice — merge to
	 *   default branches is blocked by branch protection, not the token.
	 *   Write repos are ALSO readable via the write token (a token's
	 *   permissions are uniform across its repo list), so they don't need
	 *   repeating in `read`.
	 *
	 * ADR 0004 blind spot #1 (exfiltration laundering): entries whose own
	 * repo is PUBLIC must use an explicit read list, never `"org"` —
	 * org-wide read + write-to-a-public-repo lets a prompt-injected worker
	 * copy private repo contents into public commits/PRs. Only private-repo
	 * habitats may use the broad `"org"` read.
	 */
	github?: {
		read?: "org" | string[];
		write?: string[];
	};
	/**
	 * Declared backing-storage capability (habitats ADR 0005) — the boundary
	 * the `/storage/token` relay enforces. At most one per habitat, mirroring
	 * the git repo. `read` defaults on for declared storage; `write` is
	 * opt-in. The SaaS holds the actual grant (provisioner's Clerk Google
	 * connection); this declaration can only narrow it, never widen it.
	 */
	storage?: {
		kind: "google-drive";
		read?: boolean;
		write?: boolean;
	};
	/**
	 * Last agent card seen for this habitat, with when it was captured.
	 *
	 * Discovery used to fetch every card live, which meant it only ever saw
	 * running habitats. Once habitats sleep while idle (ADR 0007) that would
	 * report almost nothing, so the Directory serves this instead — a Dormant
	 * habitat is reported with the capabilities it last advertised rather than
	 * omitted, and finding out what a habitat can do never requires waking it.
	 *
	 * Absent means never successfully fetched, which is distinct from stale.
	 */
	cachedCard?: {
		card: AgentCardSummary;
		/** ISO timestamp of the fetch that produced this card. */
		fetchedAt: string;
	};
	/** ISO timestamp */
	createdAt: string;
}

/** Persisted registry of all managed habitats. */
export interface GaiaRegistry {
	habitats: GaiaHabitatEntry[];
}

/** Container status from Docker inspect. */
export type ContainerStatus =
	| "running"
	| "exited"
	| "paused"
	| "restarting"
	| "dead"
	| "created"
	| "not-found";

/** Habitat entry enriched with live container status. */
export interface GaiaHabitatWithStatus extends GaiaHabitatEntry {
	containerStatus: ContainerStatus;
}

/** Options for creating a new habitat entry. */
export interface CreateHabitatOptions {
	id: string;
	name: string;
	gitUrl?: string;
	gitBranch?: string;
	provider?: string;
	model?: string;
	secretBindings?: string[];
	skillsFromGit?: string[];
	/** Capability-to-credential bindings for the habitat. */
	capabilities?: CapabilityBinding[];
	/** Docker image for the container (default: the standard habitat image). */
	image?: string;
	/** Public hostname for Caddy routing (#170), e.g. "twitter.example.com". */
	hostname?: string;
	/** GitHub capability declaration (see GaiaHabitatEntry.github). */
	github?: GaiaHabitatEntry["github"];
	/** Backing-storage declaration (see GaiaHabitatEntry.storage). */
	storage?: GaiaHabitatEntry["storage"];
	/**
	 * Repos this habitat reads but never writes (ADR 0006).
	 *
	 * Declaring them at creation is the point: standing a client habitat up
	 * used to be a create call plus a config update plus a scope grant plus a
	 * rebuild, with nothing tying the mounts to the scopes. Passing them here
	 * derives the read scope from them in the same step, so the two cannot
	 * drift.
	 */
	mounts?: MountedRepoSpec[];
}

/** A read-only repo mounted into a habitat. */
export interface MountedRepoSpec {
	/** Git remote to clone. */
	gitRemote: string;
	/** Branch to clone; defaults to the remote's default. */
	gitBranch?: string;
	/**
	 * Stable id for the mount. Defaults to the repo name, which is what makes
	 * `mounts: [{ gitRemote }]` the common case.
	 */
	id?: string;
	/** Display name; defaults to the id. */
	name?: string;
}

/** Status of a credential (whether it's known to be working). */
export type CredentialStatus = "active" | "expired" | "unknown";

/**
 * Metadata about a secret stored in Gaia's master vault.
 * Stores what the key grants, which provider it's for, and verification info.
 * No actual secret values — only metadata.
 */
export interface CredentialEntry {
	/** Stable machine name, e.g. "accounting-bot-read-key" */
	name: string;
	/** Human-readable label */
	label: string;
	/** Provider namespace, e.g. "intuit/quickbooks", "github", "openrouter" */
	provider: string;
	/** Capability names this credential grants, e.g. ["quickbooks:read", "quickbooks:write"] */
	capabilities: string[];
	/** Upstream OAuth scopes or API permission names, e.g. ["accounts:read"] */
	scopes: string[];
	/** Optional URL to a billing/quotas dashboard for this credential */
	dashboardUrl?: string;
	/** Where the actual secret lives: 1Password item UUID, age key name, vault entry */
	sourceVaultRef?: string;
	/** Whether this credential has been verified recently */
	status: CredentialStatus;
	/** ISO timestamp of last verification */
	lastVerified?: string;
	/** ISO timestamp when OAuth refresh token expires (if applicable) */
	refreshTokenExpiry?: string;
}

/** Options for the Gaia orchestrator server. */
export interface GaiaOrchestratorOptions {
	port?: number;
	host?: string;
	dataDir?: string;
	provider?: string;
	model?: string;
}
