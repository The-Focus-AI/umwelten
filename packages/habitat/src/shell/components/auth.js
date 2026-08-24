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
