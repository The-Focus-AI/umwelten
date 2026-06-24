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
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  X_DEFAULT_SCOPES,
} from './src/x-oauth.js';

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

  const secretValues = {
    TWITTER_CLIENT_ID: clientId,
    TWITTER_CLIENT_SECRET: clientSecret,
    TWITTER_REFRESH_TOKEN: tokens.refresh_token,
  };

  const outDir = arg('out-secrets');
  if (outDir) {
    // Write straight into the habitat's secrets.json (mode 0600) — never print the
    // values. Merge with any existing secrets.
    const path = join(outDir, 'secrets.json');
    let existing: Record<string, string> = {};
    try {
      existing = JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      /* no existing secrets file */
    }
    const merged = { ...existing, ...secretValues };
    await writeFile(path, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
    console.log(`\n✅ Wrote TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_REFRESH_TOKEN to ${path}`);
    console.log(`   (refresh token ${tokens.refresh_token.length} chars; values not printed).\n`);
  } else {
    console.log('\n✅ Success. Store these as Habitat secrets:\n');
    console.log(`   TWITTER_CLIENT_ID=${clientId}`);
    console.log(`   TWITTER_CLIENT_SECRET=${clientSecret}`);
    console.log(`   TWITTER_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('   (Tip: pass --out-secrets <habitat-dir> to write these straight into');
    console.log('   the habitat secrets.json instead of printing them.)\n');
  }
  console.log(
    'Note: X rotates refresh tokens single-use. The habitat persists each rotated\n' +
      'token back to its secrets.json, so this bootstrap value is only the seed —\n' +
      'do not reuse it once the habitat has refreshed at least once.\n',
  );
}

main().catch((err) => {
  console.error('\nBootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
