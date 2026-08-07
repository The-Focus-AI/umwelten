/**
 * Bearer credentials the Exchange issues.
 *
 * One home for both sides of the market — a Supplier's publishing credential
 * and an Application's static buying credential are the same mechanism, and
 * having one implementation is the point: a second sha256 written somewhere
 * else is how two things that must match stop matching.
 *
 * The credential itself is never stored. Only its hash is, so a database
 * compromise yields nothing that can publish or spend.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Prefix on every credential this Exchange issues.
 *
 * Two jobs: it lets the verifier tell a static credential from a JWT without
 * guessing, and it makes a leaked credential greppable in logs and repos —
 * the same reason every other vendor's keys are prefixed.
 */
export const CREDENTIAL_PREFIX = "sk-mycel-";

/** 32 bytes of entropy. Shown once at issue, never recoverable. */
export function issueCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

/**
 * Constant-time compare of two hex digests.
 *
 * Both sides are already hashes so the secret itself is not in play, but a
 * length-independent compare keeps the lookup from leaking anything about how
 * far a guess got.
 */
export function credentialsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
