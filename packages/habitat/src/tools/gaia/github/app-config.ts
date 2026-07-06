/**
 * GitHub App config resolution for Gaia (ADR 0004, decision 1).
 *
 * The private key is referenced by FILE PATH and read at use-time
 * (token-service.ts) — its contents must never enter the shared vault JSON,
 * the registry, or any config object that gets serialized. The key file
 * should live outside the vault with mode 0600; GitHub supports two
 * concurrent keys so rotation is generate → deploy → revoke.
 */

export interface GithubAppConfig {
	/** GitHub App id (numeric, kept as string). */
	appId: string;
	/** Installation id on the org the tokens are minted for. */
	installationId: string;
	/** Path to the PEM private key file — read at mint time, never cached in config. */
	privateKeyFile: string;
}

/**
 * Resolve the GitHub App config from env (GITHUB_APP_ID,
 * GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY_FILE).
 * Returns null when any of the three is unset/blank — feature off.
 */
export function resolveGithubAppConfig(
	env: Record<string, string | undefined> = process.env,
): GithubAppConfig | null {
	const appId = env.GITHUB_APP_ID?.trim();
	const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
	const privateKeyFile = env.GITHUB_APP_PRIVATE_KEY_FILE?.trim();
	if (!appId || !installationId || !privateKeyFile) return null;
	return { appId, installationId, privateKeyFile };
}
