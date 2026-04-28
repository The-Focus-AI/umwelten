/**
 * Gaia — Habitat Manager web server.
 *
 * Thin wrapper over startWebServer (src/ui/web/) that mounts:
 *   - the default route set (sessions, me, habitat)
 *   - Gaia's two legacy routes (/api/chat SSE, /api/command)
 *   - dev auth (Gaia is a single-user local tool)
 *   - the built-in Gaia UI at examples/gaia-ui/
 *
 * The actual chat plumbing (ChannelBridge, transcript persistence, etc.)
 * lives in src/ui/bridge/ and src/ui/web/ and is shared across every web
 * app (Gaia, umwelten-web-demo, future).
 */

import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Habitat } from './habitat.js';
import { startWebServer, type StartedWebServer } from '../ui/web/index.js';
import { gaiaRoutes } from './gaia-routes.js';

export interface GaiaServerOptions {
  habitat: Habitat;
  port?: number;
  host?: string;
}

export async function startGaiaServer(
  options: GaiaServerOptions,
): Promise<{ port: number; close: () => void }> {
  const { habitat, port = 3000, host = '0.0.0.0' } = options;

  // Resolve path to examples/gaia-ui (the built-in UI)
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const projectRoot = resolve(thisDir, '..', '..');
  const uiDir = join(projectRoot, 'examples', 'gaia-ui');

  const started: StartedWebServer = await startWebServer({
    habitat,
    auth: 'dev',
    port,
    host,
    routes: gaiaRoutes(),
    staticRoot: uiDir,
    platformInstruction:
      'You are responding via a web interface. Markdown is rendered natively.',
  });

  return {
    port: started.port,
    close: () => {
      void started.close();
    },
  };
}
