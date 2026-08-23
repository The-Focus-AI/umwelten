/**
 * Revertible effects, end to end: load → mutate → dispose → recovered.
 * Run with: pnpm --filter @umwelten/substrate example
 */

import { createContext } from "../src/index.js";

// A stand-in for shared environment: a routing table and a connection pool.
const routes = new Map<string, string>();
const connections: string[] = [];

function snapshot(label: string) {
  console.log(
    `${label.padEnd(18)} routes=${JSON.stringify([...routes.keys()])} connections=${JSON.stringify(connections)}`,
  );
}

const root = createContext();

// "Load a component": every mutation supplies its inverse where it happens.
const component = root.child();

component.effect(() => {
  routes.set("/chat", "chat-handler");
  return () => void routes.delete("/chat");
});

component.effect(() => {
  routes.set("/status", "status-handler");
  return () => void routes.delete("/status");
});

component.effect(async () => {
  // An async acquisition: recovery will wait for it before releasing.
  await new Promise((r) => setTimeout(r, 10));
  connections.push("db:primary");
  return () => {
    connections.splice(connections.indexOf("db:primary"), 1);
  };
});

// Let the async acquisition settle before looking (dispose would wait for
// it regardless — recovery always awaits in-flight effects).
await new Promise((r) => setTimeout(r, 20));
snapshot("after load");

// "Unload the component": one call, everything it did is undone, LIFO.
await component.dispose();
snapshot("after dispose");

// The parent is untouched and still live.
root.effect(() => {
  routes.set("/health", "health-handler");
  return () => void routes.delete("/health");
});
snapshot("parent still live");

await root.dispose();
snapshot("after root dispose");
