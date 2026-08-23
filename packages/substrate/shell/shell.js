/**
 * The Shell boot script — plain ESM, no build step. Imports the substrate,
 * fetches the host's manifest, and lets the Loader realize it. Everything
 * on the page beyond this file is a component.
 *
 * Host-agnostic: everything is resolved relative to this module's own URL,
 * per SERVING-CONTRACT.md.
 */

import {
  createContext,
  serviceKey,
  Loader,
} from "./substrate/index.js";

const base = new URL("./", import.meta.url);
const regionKey = serviceKey("shell:region");
const baseKey = serviceKey("shell:base");

const statusLine = document.getElementById("shell-status");
const report = (text, isError = false) => {
  statusLine.innerHTML = "";
  const span = document.createElement("span");
  if (isError) span.className = "err";
  span.textContent = text;
  statusLine.appendChild(span);
};

const root = createContext();
root.provide(regionKey, document.getElementById("region"));
root.provide(baseKey, base);

const loader = new Loader(root, {
  // Resolve entry urls against the shell base; version query for HMR.
  importModule: (url, generation) =>
    import(new URL(`${url}${url.includes("?") ? "&" : "?"}v=${generation}`, base).href),
});

/** version stamps from the last manifest, for hot-reload detection. */
const versions = new Map();

async function sync() {
  let manifest;
  try {
    const res = await fetch(new URL("manifest.json", base));
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    report(`failed to load manifest — ${err.message}`, true);
    return;
  }
  const entries = manifest.entries ?? [];

  // Reconcile the list (arrivals, departures, config changes)...
  await loader.apply(entries);

  // ...then hot-reload any entry whose version stamp moved — the host's
  // signal that the module behind it was edited (self-assembly, #405).
  for (const entry of entries) {
    const prev = versions.get(entry.id);
    versions.set(entry.id, entry.version);
    if (prev !== undefined && entry.version !== undefined && entry.version !== prev) {
      await loader.reload(entry.id);
    }
  }
  for (const id of [...versions.keys()]) {
    if (!entries.some((e) => e.id === id)) versions.delete(id);
  }

  const statuses = loader.entries();
  const failed = statuses.filter((e) => e.error);
  const mounted = statuses.filter((e) => e.fiber);
  report(
    `${mounted.length} component${mounted.length === 1 ? "" : "s"} mounted` +
      (failed.length
        ? ` — ${failed.map((e) => `${e.id}: ${e.error}`).join("; ")}`
        : ""),
    failed.length > 0,
  );
}

// Boot, then keep the page in step with the host: the manifest is the
// authoritative composition, polled so agent-authored components appear,
// update, and leave without a page reload.
const POLL_MS = 2000;
async function loop() {
  await sync();
  setTimeout(loop, POLL_MS);
}
loop();

// Exposed for smoke tests and the console.
window.__shell = { root, loader };
