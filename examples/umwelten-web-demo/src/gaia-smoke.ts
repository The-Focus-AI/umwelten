// Smoke-test harness for the Gaia server refactor. Boots startGaiaServer
// against the demo habitat on an alternate port.

import { Habitat } from '../../../src/habitat/habitat.js';
import { startGaiaServer } from '../../../src/habitat/gaia-server.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(__dirname, '..');

async function main() {
  const habitat = await Habitat.create({
    workDir: resolve(demoRoot, 'habitat'),
    sessionsDir: resolve(demoRoot, 'habitat-sessions'),
  });
  const { port } = await startGaiaServer({
    habitat,
    port: Number(process.env.PORT ?? 3457),
  });
  console.log(`[gaia-smoke] listening on http://localhost:${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
