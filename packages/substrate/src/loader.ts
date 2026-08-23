/**
 * The declarative loader (ADR 0031; paper §5.2): an orchestrator describes
 * the desired composition as a list of entries, and the loader realizes it
 * as mounted Fibers and keeps the two in step. Changing the list reconciles
 * incrementally — a keyed diff over entry ids — rather than tearing the
 * world down; a changed module hot-replaces through fiber operations alone.
 *
 * Transactional rule (the paper's Algorithm 10, simplified by ordering):
 * the new module is imported BEFORE the old fiber is disposed, so an entry
 * whose replacement fails to load keeps its previous component running and
 * records the error — the system never sits half-reloaded.
 *
 * Module loading is injectable; the default uses dynamic import() with a
 * version query for cache busting (the ESM cache cannot be evicted). The
 * file-watching that drives HMR in practice is host-specific and lives with
 * the host (see examples/hmr.ts) — the loader's surface is reload(id).
 */

import type { Context } from "./context.js";
import { mount, type ComponentSpec, type Fiber } from "./component.js";

export interface Entry<C = unknown> {
  /** Stable identity — the reconciliation key. */
  id: string;
  /** Module URL whose default export is the ComponentSpec. */
  url?: string;
  /** Inline spec — for built-ins and tests. Exactly one of url/component. */
  component?: ComponentSpec<C>;
  /** Passed to the component's apply. Changing it rebuilds the entry. */
  config?: C;
  /** Administratively off: unmounted but remembered. */
  disabled?: boolean;
}

export interface EntryStatus {
  id: string;
  url?: string;
  disabled: boolean;
  /** The live fiber, when mounted. */
  fiber?: Fiber;
  /** Import or mount failure for this entry, if any. */
  error?: unknown;
  /** Times this entry's module has been (re)imported. */
  generation: number;
}

export type ImportModule = (
  url: string,
  generation: number,
) => Promise<{ default: ComponentSpec<unknown> } | Record<string, unknown>>;

const defaultImport: ImportModule = async (url, generation) => {
  const sep = url.includes("?") ? "&" : "?";
  return import(/* @vite-ignore */ `${url}${sep}v=${generation}`);
};

interface Realized {
  entry: Entry;
  /** Serialized snapshot of config for change detection. */
  configKey: string;
  fiber?: Fiber;
  fiberCtx?: Context;
  error?: unknown;
  generation: number;
}

function configKeyOf(entry: Entry): string {
  return JSON.stringify(entry.config ?? null);
}

export class Loader {
  private realized = new Map<string, Realized>();
  private importModule: ImportModule;

  constructor(
    private ctx: Context,
    options?: { importModule?: ImportModule },
  ) {
    this.importModule = options?.importModule ?? defaultImport;
    // The loader's realizations die with its context.
    ctx.effect(() => async () => {
      for (const id of [...this.realized.keys()].reverse()) {
        await this.retire(id);
      }
    });
  }

  /** Current status of every entry, in application order. */
  entries(): EntryStatus[] {
    return [...this.realized.values()].map((r) => ({
      id: r.entry.id,
      url: r.entry.url,
      disabled: r.entry.disabled === true,
      fiber: r.fiber,
      error: r.error,
      generation: r.generation,
    }));
  }

  /**
   * Reconcile to the given list: retire entries that left, realize entries
   * that arrived, rebuild entries whose url/config/disabled changed, and
   * leave the rest exactly as they are.
   */
  async apply(entries: Entry[]): Promise<void> {
    const wanted = new Map(entries.map((e) => [e.id, e]));

    for (const id of [...this.realized.keys()]) {
      if (!wanted.has(id)) await this.retire(id);
    }

    for (const entry of entries) {
      const current = this.realized.get(entry.id);
      if (!current) {
        await this.realize(entry);
        continue;
      }
      const changed =
        current.entry.url !== entry.url ||
        current.configKey !== configKeyOf(entry) ||
        (current.entry.disabled === true) !== (entry.disabled === true) ||
        current.entry.component !== entry.component;
      if (changed) {
        // Rebuild in place, keeping the generation counter (a url change
        // is a fresh import regardless).
        const generation = current.generation;
        await this.retire(entry.id);
        await this.realize(entry, generation);
      }
    }
  }

  /**
   * Hot-replace one entry: re-import its module and swap the fiber. If the
   * fresh import fails, the running fiber is left untouched and the error
   * is recorded — never a half-reloaded state.
   */
  async reload(id: string): Promise<void> {
    const current = this.realized.get(id);
    if (!current) throw new Error(`No entry "${id}" to reload.`);
    const entry = current.entry;
    if (!entry.url) {
      // Inline components have no module to re-import; rebuild instead.
      await this.retire(id);
      await this.realize(entry);
      return;
    }

    const generation = current.generation + 1;
    let spec: ComponentSpec<unknown>;
    try {
      spec = await this.loadSpec(entry.url, generation);
    } catch (err) {
      // The old fiber keeps running; the error is recorded. The generation
      // still advances — a failed import is cached against its URL, so the
      // retry after a fix must not reuse the failed version query.
      current.error = err;
      current.generation = generation;
      return;
    }
    await this.retire(id);
    await this.mountSpec(entry, spec, generation);
  }

  private async loadSpec(
    url: string,
    generation: number,
  ): Promise<ComponentSpec<unknown>> {
    const mod = await this.importModule(url, generation);
    const spec = (mod as { default?: unknown }).default;
    if (!spec || typeof (spec as ComponentSpec).apply !== "function")
      throw new Error(
        `Module "${url}" does not default-export a component (need an apply function).`,
      );
    return spec as ComponentSpec<unknown>;
  }

  private async realize(entry: Entry, generation = 0): Promise<void> {
    if (entry.disabled) {
      this.realized.set(entry.id, {
        entry,
        configKey: configKeyOf(entry),
        generation,
      });
      return;
    }
    let spec: ComponentSpec<unknown>;
    const nextGeneration = entry.url ? generation + 1 : generation;
    try {
      spec = entry.component ?? (await this.loadSpec(entry.url as string, nextGeneration));
    } catch (err) {
      this.realized.set(entry.id, {
        entry,
        configKey: configKeyOf(entry),
        error: err,
        generation: nextGeneration,
      });
      return;
    }
    await this.mountSpec(entry, spec, nextGeneration);
  }

  private async mountSpec(
    entry: Entry,
    spec: ComponentSpec<unknown>,
    generation: number,
  ): Promise<void> {
    const fiberCtx = this.ctx.child();
    const fiber = mount(fiberCtx, { ...spec }, entry.config as never);
    this.realized.set(entry.id, {
      entry,
      configKey: configKeyOf(entry),
      fiber,
      fiberCtx,
      generation,
    });
    await fiber.settled();
  }

  private async retire(id: string): Promise<void> {
    const current = this.realized.get(id);
    if (!current) return;
    this.realized.delete(id);
    if (current.fiberCtx && !current.fiberCtx.disposed) {
      await current.fiberCtx.dispose();
    }
    if (current.fiber) await current.fiber.settled();
  }
}
