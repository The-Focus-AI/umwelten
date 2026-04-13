import type { IncomingMessage } from 'node:http';

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return s.split(',')[0]?.trim() || undefined;
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/$/, '');
}

/**
 * Browser-facing origin for OAuth metadata and redirects.
 * On Fly.io the edge sets X-Forwarded-Proto / Host; we prefer those over BASE_URL
 * so a mis-set secret does not break issuer vs redirect_uri.
 */
export function getPublicBaseUrl(req: IncomingMessage): string {
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
  const host = req.headers.host;

  if (forwardedProto && (forwardedHost || host)) {
    const h = forwardedHost || host!;
    return trimTrailingSlash(`${forwardedProto}://${h}`);
  }

  const envUrl = process.env.BASE_URL?.trim();
  if (envUrl) return trimTrailingSlash(envUrl);

  if (host) {
    const local =
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1') ||
      host.startsWith('[::1]');
    const proto = local ? 'http' : 'https';
    return trimTrailingSlash(`${proto}://${host}`);
  }

  return 'http://localhost:8080';
}
