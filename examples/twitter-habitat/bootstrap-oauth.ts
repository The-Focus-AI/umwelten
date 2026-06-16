/**
 * One-shot X (Twitter) OAuth 2.0 bootstrap for the Twitter habitat.
 *
 * Runs the authorize → code-exchange dance ONCE on your machine and prints the
 * resulting refresh token. You then store the three values as Habitat secrets
 * (TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_REFRESH_TOKEN); the running
 * container refreshes its access token from there and never needs a login UI.
 *
 * This script is NOT part of the running container — it is an operator tool.
 *
 * Prereqs (X developer portal → your app → User authentication settings):
 *   - Type of App: Web App / Confidential client (you have a client secret).
 *   - OAuth 2.0 enabled, with a Callback URI exactly matching --redirect
 *     (default http://localhost:9876/callback).
 *   - App permissions: Read (the v1 habitat is read-only).
 *
 * Usage:
 *   TWITTER_CLIENT_ID=... TWITTER_CLIENT_SECRET=... \
 *     pnpm tsx examples/twitter-habitat/bootstrap-oauth.ts
 *
 * Options (env or flags):
 *   --client-id / TWITTER_CLIENT_ID
 *   --client-secret / TWITTER_CLIENT_SECRET
 *   --redirect   (default http://localhost:9876/callback)
 *   --port       (default 9876 — must match the host:port in --redirect)
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  X_DEFAULT_SCOPES,
} from '@umwelten/habitat/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const clientId = arg('client-id') ?? process.env.TWITTER_CLIENT_ID;
  const clientSecret = arg('client-secret') ?? process.env.TWITTER_CLIENT_SECRET;
  const port = Number(arg('port') ?? process.env.PORT ?? 9876);
  const redirectUri = arg('redirect') ?? `http://localhost:${port}/callback`;

  if (!clientId || !clientSecret) {
    console.error(
      'Missing client credentials. Set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET\n' +
        '(or pass --client-id / --client-secret). Get them from the X developer portal.',
    );
    process.exit(1);
  }

  const client = { clientId, clientSecret };
  const state = randomBytes(16).toString('hex');
  const { verifier, challenge } = createPkcePair();
  const authorizeUrl = buildAuthorizeUrl(client, { redirectUri, state, challenge });

  const callbackPath = new URL(redirectUri).pathname;

  const code: string = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404).end('not found');
        return;
      }
      const returnedState = url.searchParams.get('state');
      const returnedCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400).end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization error: ${error}`));
        return;
      }
      if (returnedState !== state || !returnedCode) {
        res.writeHead(400).end('State mismatch or missing code. Try again.');
        server.close();
        reject(new Error('State mismatch or missing authorization code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<html><body><h2>X authorization complete.</h2>' +
          '<p>You can close this tab and return to the terminal.</p></body></html>',
      );
      server.close();
      resolve(returnedCode);
    });
    server.listen(port, () => {
      console.log(`\nScopes requested: ${X_DEFAULT_SCOPES}\n`);
      console.log('1. Open this URL in your browser and authorize the app:\n');
      console.log(`   ${authorizeUrl}\n`);
      console.log(`2. Waiting for the redirect to ${redirectUri} ...`);
    });
  });

  console.log('\nExchanging authorization code for tokens ...');
  const tokens = await exchangeCode(client, { code, redirectUri, verifier });

  console.log('\n✅ Success. Store these as Habitat secrets:\n');
  console.log(`   TWITTER_CLIENT_ID=${clientId}`);
  console.log(`   TWITTER_CLIENT_SECRET=${clientSecret}`);
  console.log(`   TWITTER_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('e.g.:');
  console.log(
    `   dotenvx run -- pnpm run cli habitat secrets set TWITTER_REFRESH_TOKEN '${tokens.refresh_token}'\n`,
  );
  console.log(
    'Note: X rotates refresh tokens single-use. The habitat persists each rotated\n' +
      'token back to its secrets.json (on a fly volume), so this bootstrap value is\n' +
      'only the seed — do not reuse it once the habitat has refreshed at least once.\n',
  );
}

main().catch((err) => {
  console.error('\nBootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
