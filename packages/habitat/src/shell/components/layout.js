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

    // Viewer preferences only: hide content without unmounting components or
    // re-parenting their iframes. Hidden panels remain recoverable in the menu.
    const panels = new Map();
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem("shell-panels") || "{}") ?? {}; } catch { /* session-only */ }
    const menu = document.createElement("details");
    menu.className = "shell-panel-menu";
    menu.innerHTML = '<summary class="btn ghost sm">Panels</summary><div class="shell-panel-options"></div>';
    header.appendChild(menu);
    const renderMenu = () => {
      const options = menu.querySelector(".shell-panel-options");
      options.replaceChildren();
      for (const [el, panel] of panels) {
        if (!el.isConnected) { panels.delete(el); continue; }
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = preferences[panel.id] !== "hidden";
        checkbox.onchange = () => panel.set(checkbox.checked ? "expanded" : "hidden");
        label.append(checkbox, document.createTextNode(panel.title));
        options.appendChild(label);
      }
      menu.hidden = panels.size === 0;
    };
    const addPanelControls = (el) => {
      if (!el.dataset.component || el.dataset.component === "chat" || panels.has(el)) return;
      const id = el.dataset.component;
      const title = el.querySelector("h2")?.textContent || id;
      const textWrappers = [];
      for (const node of [...el.childNodes]) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const span = document.createElement("span");
        node.replaceWith(span);
        span.appendChild(node);
        textWrappers.push(span);
      }
      const controls = document.createElement("div");
      controls.className = "shell-panel-controls";
      const name = document.createElement("span");
      name.textContent = title;
      const collapse = document.createElement("button");
      collapse.className = "btn ghost sm";
      collapse.type = "button";
      const hide = document.createElement("button");
      hide.className = "btn ghost sm";
      hide.type = "button";
      hide.textContent = "Hide";
      hide.setAttribute("aria-label", `Hide ${title}`);
      const renderPanel = () => {
        const state = preferences[id];
        el.classList.toggle("shell-panel-hidden", state === "hidden");
        el.classList.toggle("shell-panel-collapsed", state === "collapsed");
        collapse.textContent = state === "collapsed" ? "Expand" : "Collapse";
        collapse.setAttribute("aria-label", `${collapse.textContent} ${title}`);
        collapse.setAttribute("aria-expanded", String(state !== "collapsed"));
      };
      const set = (state) => {
        preferences[id] = state;
        try { localStorage.setItem("shell-panels", JSON.stringify(preferences)); } catch { /* best effort */ }
        renderPanel();
        renderMenu();
      };
      collapse.onclick = () => set(preferences[id] === "collapsed" ? "expanded" : "collapsed");
      hide.onclick = () => set("hidden");
      controls.append(name, collapse, hide);
      el.prepend(controls);
      panels.set(el, { id, title, set, controls, textWrappers });
      renderPanel();
    };

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
      if (!target) addPanelControls(el);
    };
    for (const el of [...region.children]) adopt(el);
    renderMenu();
    // Panels mount in manifest order, layout included — adopt late arrivals.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) adopt(n);
      renderMenu();
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
      for (const [el, panel] of panels) {
        panel.controls.remove();
        for (const span of panel.textWrappers) span.replaceWith(...span.childNodes);
        el.classList.remove("shell-panel-hidden", "shell-panel-collapsed");
      }
      menu.remove();
      for (const el of adopted) {
        if (el.isConnected && el.parentElement !== region) region.appendChild(el);
      }
      toggle.remove();
      rail.remove();
      document.body.classList.remove("shell-railed", "rail-collapsed");
    };
  },
};
