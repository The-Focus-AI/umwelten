/**
 * Demo server for the umwelten-web framework.
 *
 * Boots a minimal Habitat, registers the time tool, mounts the default web
 * routes (chat, sessions, me, habitat), and serves a Vite-built React SPA
 * from ./public.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Habitat } from '@umwelten/habitat/habitat.js';
import { timeToolSet } from '@umwelten/habitat/tool-sets.js';
import { startWebServer } from '@umwelten/habitat/web/index.js';
import { makeRenderUiTool } from '@umwelten/core/stimulus/tools/ui-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(__dirname, '..');

async function main() {
  // Allow env-based provider/model overrides so we can test the stream
  // across providers without editing habitat/config.json.
  const providerOverride = process.env.DEMO_PROVIDER;
  const modelOverride = process.env.DEMO_MODEL;

  const habitat = await Habitat.create({
    workDir: resolve(demoRoot, 'habitat'),
    sessionsDir: resolve(demoRoot, 'habitat-sessions'),
    registerCustomTools: (h) => {
      for (const [name, tool] of Object.entries(timeToolSet.createTools())) {
        h.addTool(name, tool as any);
      }
      // renderUi — generative-UI pass-through. No catalog bound here so any
      // well-formed spec is accepted; the client-side catalog decides what
      // is actually renderable.
      h.addTool('renderUi', makeRenderUiTool() as any);
    },
  });

  if (providerOverride && modelOverride) {
    habitat.setRuntimeModelDetails({
      provider: providerOverride,
      name: modelOverride,
    });
    console.log(
      `[umwelten-web-demo] provider override: ${providerOverride}/${modelOverride}`,
    );
  }

  const { port } = await startWebServer({
    habitat,
    auth: 'dev',
    staticRoot: resolve(demoRoot, 'public'),
    port: Number(process.env.PORT ?? 3000),
  });

  console.log(`[umwelten-web-demo] listening on http://localhost:${port}`);
  console.log(`  chat:    POST /api/chat`);
  console.log(`  me:      GET  /api/me`);
  console.log(`  sessions GET  /api/sessions`);
  console.log(`  habitat: GET  /api/habitat`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
