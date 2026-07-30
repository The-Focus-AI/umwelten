/**
 * Moving a habitat off the shared master vault onto its own (umwelten #284).
 *
 * The migrate step of expand–contract. #283 added the per-habitat path beside
 * the flat one; this works out, for a habitat still on the flat path, exactly
 * what its own vault would have to declare to replace it.
 *
 * Deliberately a *plan*, not an action. The output is an `fnox.toml` a human
 * commits to the habitat's repo, because the repo is the source of truth for
 * what a habitat is (ADR 0006) and a vault Gaia wrote behind the repo's back
 * would be a second place for it to be wrong. It also makes each migration
 * independently revertible in the only way that actually holds: delete the
 * file, and the habitat is back on the master vault.
 *
 * What this never does is copy secret *values* anywhere. It emits references —
 * which item in which vault — so a plan can be reviewed, committed and diffed
 * without becoming a thing that must not be logged.
 */

/** A binding to be moved, and what it will point at afterwards. */
export interface MigratedBinding {
	/** Env var name the habitat declares. Unchanged by migration. */
	name: string;
	/** Whether the master vault currently has a value for it. */
	satisfiedToday: boolean;
}

export interface VaultMigrationPlan {
	habitatId: string;
	/** 1Password vault the habitat's secrets should move into. */
	vaultName: string;
	bindings: MigratedBinding[];
	/**
	 * Bindings the master vault cannot satisfy today. Migrating does not fix
	 * these — they are already broken, and the migration is the moment someone
	 * notices, because after it the habitat will refuse to start rather than
	 * starting without them.
	 */
	unsatisfied: string[];
	/** The file to commit to the habitat's repo. */
	fnoxToml: string;
	/** True when the habitat already has its own vault — nothing to do. */
	alreadyMigrated: boolean;
}

export interface PlanMigrationInput {
	habitatId: string;
	/** Env var names the habitat declares. */
	secretBindings: readonly string[];
	/** Whether it already declares its own vault. */
	hasOwnVault: boolean;
	/** Master-vault lookup — presence only; values are never read out. */
	masterHas(name: string): boolean;
	/**
	 * 1Password vault to point at. Defaults to the habitat id, matching the
	 * vault-per-project convention the rest of the org already uses.
	 */
	vaultName?: string;
}

/**
 * `if_missing = "error"` is the point of the exercise: a habitat whose vault
 * cannot supply something it declared must fail loudly rather than resolve to
 * a partial set. That is what turns the old failure — boots, health-checks
 * green, dies on the first real question — into a refusal to start.
 */
export function renderHabitatFnoxToml(
	habitatId: string,
	vaultName: string,
	names: readonly string[],
): string {
	const header = [
		"#:schema https://fnox.jdx.dev/schema.json",
		`# Vault for the "${habitatId}" habitat (umwelten ADR 0009, #283).`,
		"#",
		"# Gaia resolves this on the host and injects the values. The container",
		"# never holds anything that could open a vault, and a value this file",
		"# cannot supply fails the habitat's start rather than letting it run",
		"# under-configured.",
		"#",
		"# These names are local to this habitat. Another habitat's entry of the",
		"# same name is a different value — which is the point of a vault per",
		"# habitat rather than one shared namespace.",
		"",
		'if_missing = "error"',
		"",
		"[providers.onepass]",
		'type = "1password"',
		`vault = "${vaultName}"`,
		"",
	];

	const entries = names.flatMap((name) => [
		`[secrets.${name}]`,
		'provider = "onepass"',
		`value = "${name}"`,
		"",
	]);

	return [...header, ...entries].join("\n");
}

export function planVaultMigration(
	input: PlanMigrationInput,
): VaultMigrationPlan {
	const vaultName = input.vaultName ?? input.habitatId;
	const bindings = input.secretBindings.map((name) => ({
		name,
		satisfiedToday: input.masterHas(name),
	}));

	return {
		habitatId: input.habitatId,
		vaultName,
		bindings,
		unsatisfied: bindings.filter((b) => !b.satisfiedToday).map((b) => b.name),
		fnoxToml: renderHabitatFnoxToml(
			input.habitatId,
			vaultName,
			input.secretBindings,
		),
		alreadyMigrated: input.hasOwnVault,
	};
}

/** Human-readable plan. Contains references, never values. */
export function describeVaultMigration(plan: VaultMigrationPlan): string {
	if (plan.alreadyMigrated) {
		return `"${plan.habitatId}" already has its own vault — nothing to migrate.`;
	}
	if (plan.bindings.length === 0) {
		return (
			`"${plan.habitatId}" declares no secrets, so it has nothing to migrate. ` +
			`It will keep resolving through the master vault until the flat path is removed (#285), ` +
			`which will be a no-op for it.`
		);
	}

	const lines = [
		`Migrating "${plan.habitatId}" onto its own vault ("${plan.vaultName}"):`,
		"",
		...plan.bindings.map(
			(b) => `  ${b.name}${b.satisfiedToday ? "" : "   ← not in the master vault today"}`,
		),
	];

	if (plan.unsatisfied.length) {
		lines.push(
			"",
			`WARNING: ${plan.unsatisfied.join(", ")} ${plan.unsatisfied.length === 1 ? "is" : "are"} not in the master vault.`,
			`This habitat is already misconfigured — migration does not cause that, it reveals it.`,
			`After migrating it will refuse to start rather than starting without them.`,
		);
	}

	lines.push(
		"",
		"To migrate:",
		`  1. Create a 1Password vault named "${plan.vaultName}" and put the items in it.`,
		`  2. Commit the fnox.toml below to the habitat's repo, next to habitat.json.`,
		`  3. Re-apply the declaration, then rebuild.`,
		"",
		"To revert: delete fnox.toml from the repo and re-apply. It goes back to the master vault.",
		"",
		plan.fnoxToml,
	);

	return lines.join("\n");
}
