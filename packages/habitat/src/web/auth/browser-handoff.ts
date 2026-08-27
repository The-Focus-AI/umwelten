/**
 * Browser login handoff from the Habitats SaaS to one child habitat.
 *
 * The URL carries only a short-lived, single-use opaque code. The child
 * redeems it server-to-server with its own static registration credential,
 * then keeps the resulting audience-bound user JWT in an HttpOnly cookie.
 */

export const HABITAT_SESSION_COOKIE = "habitat_session";

export interface BrowserHandoffConfig {
  issuer: string;
  audience: string;
  habitatId: string;
  credential: string;
}

export type BrowserHandoffResult =
  | { ok: true; accessToken: string; expiresIn: number; returnPath: string }
  | { ok: false; status: number; error: string };

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  if (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, "https://return.invalid");
    return parsed.origin === "https://return.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}

export async function redeemBrowserHandoff(
  code: string,
  config: BrowserHandoffConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BrowserHandoffResult> {
  try {
    const response = await fetchImpl(
      new URL("/api/auth/handoff/exchange", config.issuer),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          code,
          habitat_id: config.habitatId,
          audience: config.audience,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof body.error === "string" ? body.error : "login handoff failed",
      };
    }
    const accessToken = body.access_token;
    const expiresIn = body.expires_in;
    const returnPath = safeReturnPath(body.return_to);
    if (
      typeof accessToken !== "string" ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > 300 ||
      !returnPath
    ) {
      return { ok: false, status: 502, error: "invalid login handoff response" };
    }
    return { ok: true, accessToken, expiresIn, returnPath };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "login handoff failed",
    };
  }
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${HABITAT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(maxAge)}`;
}
