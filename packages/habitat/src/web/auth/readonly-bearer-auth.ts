/**
 * A second bearer that authenticates to a read-only scope (#165 groundwork).
 *
 * The shared `HABITAT_API_KEY` is the operator credential: it can stop
 * containers, write secrets and cycle the fleet. Handing it to anyone who only
 * needs to watch — a monitoring job, an agent checking its own work — grants
 * far more than the job needs, and it is the same key everywhere, so it cannot
 * be revoked for one consumer without breaking the rest.
 *
 * `HABITAT_READONLY_API_KEY` is a separate value with a separate lifetime.
 * A caller presenting it is never an operator, and its toolset is narrowed to
 * an explicit allowlist (see `identity/caller-scope.ts`). Rotating or revoking
 * it does not touch the operator key.
 */

import type { IncomingMessage } from "node:http";
import type { AuthProvider, UserContext } from "../types.js";

/** Fixed principal for the read-only bearer, mirroring 'bearer-user'. */
export const READONLY_PRINCIPAL = "readonly-bearer";

export function readonlyBearerAuth(apiKey: string): AuthProvider {
  return {
    name: "readonly-bearer",
    async authenticate(req: IncomingMessage): Promise<UserContext | null> {
      const header = req.headers.authorization;
      if (!header) return null;

      const [scheme, token] = header.split(" ", 2);
      if (scheme?.toLowerCase() !== "bearer" || !token) return null;
      if (token !== apiKey) return null;

      return {
        userId: READONLY_PRINCIPAL,
        provider: "oauth",
        // Never an operator: this must not satisfy the isOperator check that
        // gates writing a habitat's declared credentials.
        operator: false,
        readOnly: true,
      };
    },
  };
}
