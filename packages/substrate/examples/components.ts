/**
 * Three components with a provider chain; unload the middle one and watch
 * the cascade. Run with: npx tsx packages/substrate/examples/components.ts
 */

import {
  createContext,
  mount,
  serviceKey,
  type ComponentSpec,
} from "../src/index.js";

const store = serviceKey<Map<string, string>>("store");
const feed = serviceKey<{ post: (m: string) => void }>("feed");

const log = (m: string) => console.log(`  ${m}`);

// Bottom: provides the store.
const storage: ComponentSpec = {
  name: "storage",
  apply(ctx) {
    log("storage up (provides store)");
    ctx.provide(store, new Map());
    return () => log("storage down");
  },
};

// Middle: needs the store, provides the feed.
const feedService: ComponentSpec = {
  name: "feed-service",
  inject: [store],
  apply(ctx, view) {
    const backing = view.get(store);
    log("feed-service up (needs store, provides feed)");
    ctx.provide(feed, {
      post: (m) => backing.set(String(backing.size), m),
    });
    return () => log("feed-service down");
  },
};

// Top: needs the feed.
const reporter: ComponentSpec = {
  name: "reporter",
  inject: [feed],
  apply(_ctx, view) {
    view.get(feed).post("reporter arrived");
    log("reporter up (needs feed)");
    return () => log("reporter down — drained before feed disappears");
  },
};

const root = createContext();

console.log("mounting storage, feed-service, reporter:");
mount(root, storage);
const middle = mount(root, feedService);
const top = mount(root, reporter);
await top.settled();
await new Promise((r) => setTimeout(r, 0));

console.log("\nunmounting the middle component (feed-service):");
await middle.unmount();
console.log(
  `  → reporter active? ${top.active} (missing: ${top.missing.map((k) => k.id).join(", ")})`,
);

console.log("\nremounting feed-service:");
mount(root, feedService);
await top.settled();
await new Promise((r) => setTimeout(r, 0));
console.log(`  → reporter active? ${top.active} (reactivated, no orchestration)`);

console.log("\ndisposing the root:");
await root.dispose();
