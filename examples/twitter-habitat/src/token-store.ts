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
  /** The verified speaking user (ADR 0003) when present — keys per-user tokens. */
  getCurrentUserId?(): string | undefined;
  /** Secret names, no values — lets {@link perUserTokenStores} diagnose which token keys exist. */
  listSecretNames?(): string[];
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
  /**
   * The speaking user (verified A2A `sub`, ADR 0003). When set, the refresh
   * token is read/written under a per-user secret key
   * (`TWITTER_REFRESH_TOKEN:<subject>`) so each user has their own X account.
   * Omitted ⇒ the single shared operator token (`TWITTER_REFRESH_TOKEN`) — the
   * original single-tenant behavior.
   */
  subject?: string;
}

/** Per-user refresh-token secret key, or the shared operator key when no subject. */
export function refreshTokenSecretKey(subject?: string): string {
  return subject ? `${X_REFRESH_TOKEN_SECRET}:${subject}` : X_REFRESH_TOKEN_SECRET;
}

export class XTokenStore {
  private readonly secrets: SecretStore;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly skewMs: number;
  /** Secret key holding this store's (rotating) refresh token — per-user or shared. */
  private readonly refreshKey: string;

  private cachedAccessToken: string | undefined;
  private expiresAtMs = 0;
  /** Single-flight guard: one in-flight refresh shared by all concurrent callers. */
  private inFlight: Promise<string> | undefined;

  constructor(opts: XTokenStoreOptions) {
    this.secrets = opts.secrets;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    this.refreshKey = refreshTokenSecretKey(opts.subject);
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
    const refreshToken = this.secrets.get(this.refreshKey);
    if (!refreshToken) {
      throw new XAuthError(
        `No X refresh token found (secret ${this.refreshKey}). Connect this user's ` +
          `X account (or run the OAuth bootstrap) so the token is stored before using ` +
          `the Twitter tools.`,
        'needs_reauth',
      );
    }

    const tokens = await refreshAccessToken(this.getClient(), refreshToken, this.fetchFn);

    // Persist the rotated refresh token BEFORE returning (transaction): X has already
    // consumed the old one server-side, so the new one must reach durable storage or
    // the next refresh is dead. Do this before updating the cache or releasing the lock.
    await this.secrets.set(this.refreshKey, tokens.refresh_token);

    this.cachedAccessToken = tokens.access_token;
    this.expiresAtMs = this.now() + (tokens.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000;
    return tokens.access_token;
  }
}

/**
 * Per-user token-store registry for the private read tools (ADR 0003 / #176).
 *
 * Resolves the current speaker via `habitat.getCurrentUserId()` and hands back a
 * subject-scoped {@link XTokenStore} (cached per subject so the access-token
 * cache + single-flight refresh are shared across calls for that user). When
 * there is no speaker (off the A2A path, or no per-user grant) it falls back to
 * the shared operator store — preserving single-tenant behavior.
 */
export function perUserTokenStores(habitat: HabitatLike) {
  const secrets = habitatSecretStore(habitat);
  const bySubject = new Map<string, XTokenStore>();
  return {
    /** The current speaker's `sub`, or undefined (operator/shared mode). */
    currentSubject(): string | undefined {
      return habitat.getCurrentUserId?.();
    },
    /** Token store for the current speaker (or the shared operator token). */
    current(): XTokenStore {
      const subject = habitat.getCurrentUserId?.();
      const key = subject ?? "";
      let store = bySubject.get(key);
      if (!store) {
        store = new XTokenStore({ secrets, subject });
        bySubject.set(key, store);
      }
      return store;
    },
    /**
     * Actionable "connect X" error for the read tools' needs_reauth catch.
     *
     * Looks at which token keys actually exist (names only) to tell apart the
     * three ways a lookup comes up empty:
     *
     *  1. Speaker known, no token under their key → they haven't connected;
     *     point them at the connect flow.
     *  2. No speaker (request authenticated with the shared HABITAT_API_KEY /
     *     off the A2A path) but per-user tokens EXIST → identity mismatch:
     *     someone connected via the per-user flow, yet this request can only
     *     see the shared operator token. The usual cause is an agent
     *     attachment that predates per-user JWT dispatch — re-attaching in
     *     the habitats app fixes it. Without this hint the habitat says
     *     "not connected" to a user who just connected, which reads as the
     *     OAuth silently failing.
     *  3. Nothing stored at all → original bootstrap message.
     */
    connectError(): { error: string; kind: 'needs_x_connect' } {
      const subject = habitat.getCurrentUserId?.();
      const names = habitat.listSecretNames?.() ?? [];
      const perUserCount = names.filter((n) =>
        n.startsWith(`${X_REFRESH_TOKEN_SECRET}:`),
      ).length;
      if (subject) {
        return {
          error:
            "Your X account isn't connected yet for your user identity. " +
            'Connect it from the habitats app (the agent’s "Connect your X account" flow) and try again.',
          kind: 'needs_x_connect',
        };
      }
      if (perUserCount > 0) {
        return {
          error:
            `This request arrived without a per-user identity (shared operator key), so only the ` +
            `shared operator X token is visible — and none is set. However, ${perUserCount} X ` +
            `account(s) ARE connected under per-user identities. This usually means the agent ` +
            `attachment still dispatches with the legacy shared bearer while the X connect flow ` +
            `stored the token under the connecting user’s identity. Fix: detach and re-attach ` +
            `this agent in the habitats app so messages carry per-user identity (JWT) — the ` +
            `already-connected account will then be found. (Alternatively, an operator can ` +
            `connect a habitat-wide account.)`,
          kind: 'needs_x_connect',
        };
      }
      return {
        error:
          'Twitter is not authenticated. Connect an X account (or run the OAuth bootstrap) for this habitat.',
        kind: 'needs_x_connect',
      };
    },
  };
}
