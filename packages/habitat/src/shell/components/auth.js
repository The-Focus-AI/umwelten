/**
 * Shared token resolution for shell components — one convention, one place.
 *
 * Order: explicit config → ?token= in the URL (persisted to the same
 * "habitat-token" key the old dashboard uses, so the two UIs share auth on
 * an origin) → stored token. Comma-tolerant: a pasted comma-separated key
 * list (the GAIA_API_KEY format) is trimmed to its first key, since the
 * server matches each key individually — this exact paste happened in the
 * first live test.
 */

export function resolveToken(configToken) {
  const first = (v) => (v ? String(v).split(",")[0].trim() : undefined);
  if (configToken) return first(configToken);
  try {
    const fromUrl = first(new URLSearchParams(location.search).get("token"));
    if (fromUrl) {
      localStorage.setItem("habitat-token", fromUrl);
      return fromUrl;
    }
    return (
      first(localStorage.getItem("habitat-token")) ??
      first(localStorage.getItem("shell:token"))
    );
  } catch {
    return undefined;
  }
}

export function authHeaders(token, extra = {}) {
  const h = { ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

let session;
let redirecting = false;
const loginAttemptKey = "shell:login-attempt";

/** Capture identity while the cookie is still valid; shared by chat and tools. */
export function browserSession(base, token) {
  if (token || new URL(base).origin !== location.origin)
    return Promise.resolve(null);
  return (session ??= fetch(new URL("/auth/session", base), {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  })
    .then(async (res) => (res.ok ? res.json() : null))
    .then((value) =>
      value?.browserLogin && typeof value.userId === "string" ? value : null,
    )
    .catch(() => null));
}

/** Only called for an explicit HTTP 401, never a failed/ambiguous stream. */
export async function signInAgain(base, token) {
  const identity = await browserSession(base, token);
  if (!identity) return false;
  if (redirecting) return true;
  try {
    // A broken/rejected login must not cause an automatic navigation loop.
    const lastAttempt = Number(sessionStorage.getItem(loginAttemptKey));
    if (lastAttempt && Date.now() - lastAttempt < 60_000) return false;
    const checkpoint = new CustomEvent("shell:before-sign-in", {
      cancelable: true,
      detail: { userId: identity.userId },
    });
    if (!window.dispatchEvent(checkpoint)) return false;
    sessionStorage.setItem(loginAttemptKey, String(Date.now()));
    const returnTo = new URL(location.href);
    returnTo.searchParams.delete("token");
    const login = new URL("/auth/login", location.origin);
    login.searchParams.set(
      "return_to",
      returnTo.pathname + returnTo.search + returnTo.hash,
    );
    redirecting = true;
    location.assign(login.href);
    return true;
  } catch {
    // If storage is unavailable, retain the live conversation rather than
    // navigating away and losing the user's work.
    return false;
  }
}

export const signInMessage =
  "Your session expired. Sign in again at /auth/login to continue. Copy your draft before leaving this page.";
