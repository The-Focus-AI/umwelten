/**
 * X (Twitter) token store — the deep module behind the Twitter habitat's
 * private-data path (bookmarks, mentions, my timeline).
 *
 * Encapsulates the X OAuth token lifecycle behind a single {@link XTokenStore.getValidToken}
 * interface so every read tool stays thin and the security-relevant logic lives
 * (and is tested) in one place:
 *
 *  - return the cached access token when it is still valid — no network call;
 *  - refresh via the refresh_token grant when expired (proactive 5-min skew),
 *    forced (reactive, after a 401 from an X API call), or when no token is cached yet;
 *  - persist the rotated (single-use) refresh token back to the secret store
 *    BEFORE returning, so a container restart stays authenticated;
 *  - coalesce concurrent refreshes into a single in-flight grant — two callers
 *    must never present the same single-use refresh token (that kills it);
 *  - surface a clear, actionable error when no refresh token is present
 *    (the operator must run the OAuth bootstrap first).
 *
 * The secret store is injected ({@link SecretStore}) so the module is decoupled
 * from `Habitat` and fully testable with an in-memory fake. A Habitat is wrapped
 * via {@link habitatSecretStore}.
 *
 * Design grounded in reports/2026-06-16-x-oauth2-token-refresh.md.
 */

import {
  refreshAccessToken,
  XAuthError,
  type FetchLike,
  type XOAuthClient,
} from './x-oauth.js';

/** Secret name holding the X confidential-client id. */
export const X_CLIENT_ID_SECRET = 'TWITTER_CLIENT_ID';
/** Secret name holding the X confidential-client secret. */
export const X_CLIENT_SECRET_SECRET = 'TWITTER_CLIENT_SECRET';
/** Secret name holding the current (rotating, single-use) X refresh token. */
export const X_REFRESH_TOKEN_SECRET = 'TWITTER_REFRESH_TOKEN';

/** Default access-token lifetime (seconds) when X omits `expires_in`. */
const DEFAULT_EXPIRES_IN_S = 7200;
/** Refresh this many ms before the access token actually expires (clock skew). */
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Minimal read/write secret store. Implemented by {@link habitatSecretStore} over
 * a `Habitat`, and by an in-memory fake in tests. `set` must persist durably
 * (e.g. write secrets.json) so a rotated refresh token survives a restart.
 */
export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): Promise<void>;
}

/** Subset of the Habitat secret API the store needs. */
interface HabitatLike {
  getSecret(name: string): string | undefined;
  setSecret(name: string, value: string): Promise<void>;
}

/** Adapt a `Habitat` (or anything with getSecret/setSecret) into a {@link SecretStore}. */
export function habitatSecretStore(habitat: HabitatLike): SecretStore {
  return {
    get: (name) => habitat.getSecret(name),
    set: (name, value) => habitat.setSecret(name, value),
  };
}

export interface XTokenStoreOptions {
  secrets: SecretStore;
  /** Injectable fetch (defaults to global fetch). */
  fetchFn?: FetchLike;
  /** Injectable clock in ms (defaults to Date.now), for deterministic expiry tests. */
  now?: () => number;
  /** Refresh this many ms before expiry. Defaults to 5 minutes. */
  refreshSkewMs?: number;
}

export class XTokenStore {
  private readonly secrets: SecretStore;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly skewMs: number;

  private cachedAccessToken: string | undefined;
  private expiresAtMs = 0;
  /** Single-flight guard: one in-flight refresh shared by all concurrent callers. */
  private inFlight: Promise<string> | undefined;

  constructor(opts: XTokenStoreOptions) {
    this.secrets = opts.secrets;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  /**
   * Return a valid X access token, refreshing if necessary.
   *
   * @param opts.forceRefresh - bypass the cache and refresh now. Call this after
   *   an X API request returns 401 (the access token went stale before expiry),
   *   then retry the request once.
   */
  async getValidToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
    if (!opts.forceRefresh && this.cachedAccessToken && this.now() < this.expiresAtMs - this.skewMs) {
      return this.cachedAccessToken;
    }
    // Coalesce concurrent refreshes — never present the single-use refresh token twice.
    if (!this.inFlight) {
      this.inFlight = this.refresh().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private getClient(): XOAuthClient {
    const clientId = this.secrets.get(X_CLIENT_ID_SECRET);
    const clientSecret = this.secrets.get(X_CLIENT_SECRET_SECRET);
    if (!clientId || !clientSecret) {
      throw new XAuthError(
        `Missing X client credentials. Set the ${X_CLIENT_ID_SECRET} and ` +
          `${X_CLIENT_SECRET_SECRET} habitat secrets.`,
        'config',
      );
    }
    return { clientId, clientSecret };
  }

  private async refresh(): Promise<string> {
    const refreshToken = this.secrets.get(X_REFRESH_TOKEN_SECRET);
    if (!refreshToken) {
      throw new XAuthError(
        `No X refresh token found. Run the OAuth bootstrap script and store the result ` +
          `as the ${X_REFRESH_TOKEN_SECRET} habitat secret before using the Twitter tools.`,
        'needs_reauth',
      );
    }

    const tokens = await refreshAccessToken(this.getClient(), refreshToken, this.fetchFn);

    // Persist the rotated refresh token BEFORE returning (transaction): X has already
    // consumed the old one server-side, so the new one must reach durable storage or
    // the next refresh is dead. Do this before updating the cache or releasing the lock.
    await this.secrets.set(X_REFRESH_TOKEN_SECRET, tokens.refresh_token);

    this.cachedAccessToken = tokens.access_token;
    this.expiresAtMs = this.now() + (tokens.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000;
    return tokens.access_token;
  }
}
