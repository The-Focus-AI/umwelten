/**
 * GitHub App authentication primitives (ADR 0004).
 *
 * Pure module: builds the App JWT (RS256 via node:crypto) and mints
 * per-installation access tokens against the GitHub REST API. No caching,
 * no file IO, no env reads — config plumbing lives in ./app-config.ts and
 * caching in ./token-service.ts.
 *
 * Token format note: since April 2026 installation tokens use a long
 * stateless format (`ghs_<appid>_<jwt>`). NEVER assume 40-char tokens or
 * validate token shape/length here — treat the token as an opaque string.
 */

import { createSign } from "node:crypto";

const GITHUB_API_BASE = "https://api.github.com";

/** Seconds of clock-skew backdating GitHub recommends for the iat claim. */
const IAT_BACKDATE_SECONDS = 60;
/** JWT lifetime: 9 minutes (GitHub caps App JWTs at 10). */
const JWT_TTL_SECONDS = 540;

function base64url(input: string | Buffer): string {
	return Buffer.from(input).toString("base64url");
}

export interface BuildAppJwtOptions {
	/** GitHub App id (the numeric id, as a string or number). */
	appId: string | number;
	/** PEM-encoded RSA private key for the App. */
	privateKeyPem: string;
	/** Current time in seconds since epoch (default: now). Injectable for tests. */
	now?: number;
}

/**
 * Build the short-lived RS256 JWT a GitHub App authenticates with.
 * Header {alg: RS256, typ: JWT}; claims iat = now-60, exp = now+540, iss = appId.
 */
export function buildAppJwt(options: BuildAppJwtOptions): string {
	const now = options.now ?? Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const claims = {
		iat: now - IAT_BACKDATE_SECONDS,
		exp: now + JWT_TTL_SECONDS,
		iss: String(options.appId),
	};
	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
	const signature = createSign("RSA-SHA256")
		.update(signingInput)
		.sign(options.privateKeyPem);
	return `${signingInput}.${base64url(signature)}`;
}

export interface MintInstallationTokenOptions {
	appId: string | number;
	privateKeyPem: string;
	/** Installation id the token is minted for. */
	installationId: string | number;
	/**
	 * Down-scope to these repo names (owner implied by the installation).
	 * Omitted ⇒ the token covers every repo in the installation.
	 */
	repositories?: string[];
	/**
	 * Down-scope to this permissions subset, e.g. { contents: "read" }.
	 * Omitted ⇒ the App's full installed permissions.
	 */
	permissions?: Record<string, string>;
}

export interface MintDeps {
	/** fetch implementation (default: global fetch). Injectable for tests. */
	fetchImpl?: typeof fetch;
	/** Current time in seconds since epoch (for the JWT). Injectable for tests. */
	now?: () => number;
}

export interface InstallationToken {
	/** Opaque installation token — never assume format or length. */
	token: string;
	/** When GitHub expires the token (~1 hour after mint). */
	expiresAt: Date;
}

/**
 * Mint a (possibly down-scoped) installation access token.
 *
 * POST /app/installations/:installationId/access_tokens with the App JWT.
 * The JSON body carries `repositories` / `permissions` only when provided —
 * an empty body mints the installation's full default token.
 * Throws (with a response-body excerpt) on any non-201 response.
 */
export async function mintInstallationToken(
	options: MintInstallationTokenOptions,
	deps: MintDeps = {},
): Promise<InstallationToken> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const jwt = buildAppJwt({
		appId: options.appId,
		privateKeyPem: options.privateKeyPem,
		now: deps.now?.(),
	});

	const body: Record<string, unknown> = {};
	if (options.repositories !== undefined) body.repositories = options.repositories;
	if (options.permissions !== undefined) body.permissions = options.permissions;
	const hasBody = Object.keys(body).length > 0;

	const url = `${GITHUB_API_BASE}/app/installations/${options.installationId}/access_tokens`;
	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			Accept: "application/vnd.github+json",
			...(hasBody ? { "Content-Type": "application/json" } : {}),
		},
		...(hasBody ? { body: JSON.stringify(body) } : {}),
	});

	if (response.status !== 201) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`GitHub installation token mint failed (${response.status}) for installation ${options.installationId}: ${text.slice(0, 300)}`,
		);
	}

	const data = (await response.json()) as { token: string; expires_at: string };
	return { token: data.token, expiresAt: new Date(data.expires_at) };
}
