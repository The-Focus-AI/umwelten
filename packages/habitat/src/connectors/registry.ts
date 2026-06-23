// Build the set of upstream connectors available on this habitat.
//
// Inert by default (mirrors the secret-write receiver, #189): a provider only
// activates when its credentials are configured. X activates when
// TWITTER_CLIENT_ID + TWITTER_CLIENT_SECRET are set.

import type { UpstreamConnector } from "./types.js";
import { createXConnector } from "./x.js";

export function buildDefaultConnectors(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, UpstreamConnector> {
  const connectors = new Map<string, UpstreamConnector>();

  const xId = env.TWITTER_CLIENT_ID?.trim();
  const xSecret = env.TWITTER_CLIENT_SECRET?.trim();
  if (xId && xSecret) {
    connectors.set(
      "x",
      createXConnector({ clientId: xId, clientSecret: xSecret }),
    );
  }

  return connectors;
}
