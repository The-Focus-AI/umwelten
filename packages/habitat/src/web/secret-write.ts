/**
 * Habitat secret-write allowlist — narrow surface for per-user token delivery
 * (ADR 0003 / habitats #56).
 *
 * The habitats SaaS pushes a user's upstream token (e.g. their X refresh token)
 * to a running habitat as the secret `TWITTER_REFRESH_TOKEN:<sub>` so the
 * twitter habitat can read it per-speaker (umwelten #176). `POST /api/secrets`
 * is the receiver — but a generic "set any secret" endpoint is dangerous, so it
 * is:
 *   - OFF by default — only enabled when `HABITAT_SECRET_WRITE_PREFIXES` is set
 *     (comma-separated list of allowed name prefixes);
 *   - restricted to names that match one of those prefixes AND carry a suffix
 *     (so the bare prefix alone can't be written).
 *
 * It is still auth-gated by the server (jwt/bearer) on top of this.
 */

/** Parse the comma-separated `HABITAT_SECRET_WRITE_PREFIXES` env into a list. */
export function parseSecretWritePrefixes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True when `name` may be written: at least one prefix is configured, and the
 * name starts with a configured prefix and has a non-empty suffix after it.
 */
export function isSecretWriteAllowed(name: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  return prefixes.some((p) => name.startsWith(p) && name.length > p.length);
}
