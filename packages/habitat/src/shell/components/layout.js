/**
 * The stock layout (ADR 0034, #423): the common app-shell arrangement as a
 * component — a collapsible left rail (status, quick-prompts) with an admin
 * cluster pinned at its bottom (secrets, sessions), and main as the familiar
 * auto-flow grid. Everything else — chat, wide panels, custom components,
 * foreign mounts — stays in main, untouched: foreign iframes are never
 * re-parented, so they never reload.
 *
 * The layout owns the placement map; panels stay region-unaware. Placement
 * identity is `data-component`. The rail is a container this component
 * creates and owns — mapped panels are adopted into it and returned to the
 * region on dispose, so removing the layout is the bare grid again.
 *
 * Visual language lives in theme.css (Habitats v0.2). This module only
 * applies the stock class names.
 *
 * To change the arrangement in chat, create a component named `layout`:
 * the host disables this stock entry whenever a custom `layout` exists, so
 * yours replaces it — and removing yours brings this one back. Start from
 * this file's shape: a placement map, containers you own, and a disposer
 * that puts everything back.
 */

import { serviceKey } from "../substrate/index.js";

const regionKey = serviceKey("shell:region");

/** The placement map: data-component → rail | rail-admin. Unmapped → main. */
const RAIL = ["status", "quick-prompts"];
const RAIL_ADMIN = ["secrets", "sessions"];

const STORE_KEY = "shell-rail-collapsed";

export default {
  name: "layout",
  inject: [regionKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const header = document.querySelector("body > header");
    // Solo pages carry no shell chrome — a projection stays single-component
    // (ADR 0034), so the layout is a no-op there.
    if (!header) return () => {};

    const rail = document.createElement("aside");
    rail.className = "shell-rail lrail";
    rail.innerHTML = `<div class="rail-stack"></div><div class="rail-admin"></div>`;
    region.parentElement.insertBefore(rail, region);
    const stack = rail.querySelector(".rail-stack");
    const admin = rail.querySelector(".rail-admin");
    document.body.classList.add("shell-railed");

    /** Panels this layout moved, to return on dispose. */
    const adopted = new Set();
    const targetOf = (el) => {
      const id = el.dataset?.component ?? "";
      if (RAIL.includes(id)) return stack;
      if (RAIL_ADMIN.includes(id)) return admin;
      return null; // main — never touched
    };
    const adopt = (el) => {
      if (!(el instanceof HTMLElement)) return;
      const target = targetOf(el);
      if (target && el.parentElement !== target) {
        adopted.add(el);
        target.appendChild(el);
      }
    };
    for (const el of [...region.children]) adopt(el);
    // Panels mount in manifest order, layout included — adopt late arrivals.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) adopt(n);
    });
    observer.observe(region, { childList: true });

    // Collapse: the one viewer-side control (a preference, not an
    // arrangement) — remembered per viewer, best-effort.
    const toggle = document.createElement("button");
    toggle.className = "rail-toggle btn ghost sm";
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(STORE_KEY) === "1";
    } catch {
      // storage unavailable — session-only collapse still works
    }
    const render = () => {
      document.body.classList.toggle("rail-collapsed", collapsed);
      toggle.textContent = collapsed ? "show rail" : "hide rail";
    };
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      try {
        localStorage.setItem(STORE_KEY, collapsed ? "1" : "0");
      } catch {
        // best-effort only
      }
      render();
    });
    render();
    header.appendChild(toggle);

    return () => {
      observer.disconnect();
      for (const el of adopted) {
        if (el.isConnected && el.parentElement !== region) region.appendChild(el);
      }
      toggle.remove();
      rail.remove();
      document.body.classList.remove("shell-railed", "rail-collapsed");
    };
  },
};
