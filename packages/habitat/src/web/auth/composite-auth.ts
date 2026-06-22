/**
 * Composite auth — try each provider in order; the first to return a
 * UserContext wins (ADR 0003 transition).
 *
 * Lets a habitat accept a per-user JWT (identity — from the SaaS) AND the
 * legacy shared bearer (service trust — e.g. Gaia's dashboard/relay, which
 * dials children with the shared HABITAT_API_KEY) at the same time. Without
 * this, turning on JWT verification would lock out Gaia's own relay.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthProvider, UserContext } from "../types.js";

export function compositeAuth(
  name: string,
  providers: AuthProvider[],
): AuthProvider {
  return {
    name,
    async authenticate(req: IncomingMessage): Promise<UserContext | null> {
      for (const p of providers) {
        const user = await p.authenticate(req);
        if (user) return user;
      }
      return null;
    },
    async handleAuthRoute(
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<boolean> {
      for (const p of providers) {
        if (p.handleAuthRoute && (await p.handleAuthRoute(req, res))) return true;
      }
      return false;
    },
  };
}
