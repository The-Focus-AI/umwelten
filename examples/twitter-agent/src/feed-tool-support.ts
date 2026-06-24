/**
 * Shared wiring for the public-data Agent tools (person-recent, list-digest,
 * high-engagement). Keeps the tool handlers thin: they call into here for the
 * one thing they all need — a {@link FeedReader} bound to the habitat's Neon
 * `DATABASE_URL` — and embed no SQL or connection logic themselves.
 *
 * `DATABASE_URL` is read from Habitat secrets first, then `process.env`
 * (fly.io injects secrets as env vars). It is the ONLY credential this path
 * needs — no twitterapi.io key, no X OAuth token.
 */

import { FeedReader, neonExecutor } from './feed-reader.js';

/** Secret/env name holding the Neon connection string the feed reader queries. */
export const DATABASE_URL_SECRET = 'DATABASE_URL';

/** Subset of the Habitat secret API these tools need. */
export interface HabitatSecretReader {
  getSecret(name: string): string | undefined;
}

/** Thrown when no DATABASE_URL is configured — the operator must set it. */
export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      `No ${DATABASE_URL_SECRET} configured. Set the ${DATABASE_URL_SECRET} habitat ` +
        `secret (or env var) to the Neon database the twitter-feed pipeline syncs.`,
    );
    this.name = 'MissingDatabaseUrlError';
  }
}

/** Resolve the Neon connection string: Habitat secret first, then env. */
export function resolveDatabaseUrl(habitat: HabitatSecretReader): string | undefined {
  return habitat.getSecret(DATABASE_URL_SECRET) ?? process.env[DATABASE_URL_SECRET];
}

/**
 * Build a getter that lazily constructs one {@link FeedReader} on first use and
 * reuses it thereafter (the underlying `neon()` handle is a cheap stateless fetch
 * closure). A missing DATABASE_URL is not cached, so setting the secret and
 * retrying works without restarting the habitat.
 */
export function lazyFeedReader(habitat: HabitatSecretReader): () => Promise<FeedReader> {
  let cached: FeedReader | undefined;
  return async () => {
    if (cached) return cached;
    const url = resolveDatabaseUrl(habitat);
    if (!url) throw new MissingDatabaseUrlError();
    const exec = await neonExecutor(url);
    cached = new FeedReader(exec);
    return cached;
  };
}

/** Map an error to a tool result, with a friendly message for the missing-DB case. */
export function toErrorResult(err: unknown): { error: string; kind?: string } {
  if (err instanceof MissingDatabaseUrlError) {
    return { error: err.message, kind: 'config' };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}
