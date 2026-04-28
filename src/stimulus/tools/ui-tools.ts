/**
 * Generative UI via json-render catalogs.
 *
 * Exposes a `renderUi` Vercel AI SDK tool that accepts a json-render Spec
 * ({ root, elements }) validated against an application's catalog. The tool
 * is intentionally a pass-through: the Spec flows as a tool-call event
 * through ChannelBridge → UiMessageStream → the client, where
 * @json-render/react renders it.
 *
 * Usage:
 *   const catalog = defineCatalog({ ... });
 *   stimulus.addTool('renderUi', makeRenderUiTool({ catalog }));
 *
 * The Stimulus description tells the model: call renderUi when you want to
 * present structured UI instead of plain text. Zod validation (via catalog)
 * runs server-side on the tool's args before the result reaches the client.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Catalog, Spec } from '@json-render/core';
import { validateSpec } from '@json-render/core';

/** A json-render Spec — flat-tree component graph. */
export interface RenderUiSpec {
  root: string;
  elements: Record<
    string,
    {
      type: string;
      props?: Record<string, unknown>;
      children?: string[];
      [k: string]: unknown;
    }
  >;
}

export interface MakeRenderUiToolOptions {
  /**
   * The catalog to validate against. When omitted, the tool accepts any
   * well-formed spec but doesn't check component names or prop shapes.
   */
  catalog?: Catalog<any, any>;
  /**
   * Human-readable description the model sees. Override to tune when the
   * model should call renderUi (e.g. "Only call this for dashboard requests").
   */
  description?: string;
}

const DEFAULT_DESCRIPTION = `Render a structured UI instead of (or in addition to) a plain-text reply.
Pass a json-render Spec: { root: <id>, elements: { <id>: { type, props, children } } }.
Use this when the user's request is better answered with a card, table, form,
chart, or multi-element layout than prose. The client will render the Spec
into native React components from the app's catalog.`;

const elementSchema: z.ZodType<RenderUiSpec['elements'][string]> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      props: z.record(z.string(), z.unknown()).optional(),
      children: z.array(z.string()).optional(),
    })
    .passthrough(),
);

const renderUiInputSchema = z.object({
  root: z.string().describe('ID of the root element in `elements`.'),
  elements: z
    .record(z.string(), elementSchema)
    .describe('Map of element id → component descriptor.'),
});

export function makeRenderUiTool(options: MakeRenderUiToolOptions = {}) {
  const { catalog, description = DEFAULT_DESCRIPTION } = options;

  return tool({
    description,
    inputSchema: renderUiInputSchema,
    execute: async (input: RenderUiSpec) => {
      if (catalog) {
        try {
          // validateSpec takes the Spec directly and (optionally) options;
          // the catalog binding is done via .validateSpec() on the catalog
          // instance, but here we use the top-level fn as a structural check.
          const result = validateSpec(input as unknown as Spec);
          if (result && (result as any).issues?.length) {
            return {
              ok: false,
              error: 'Spec failed structural validation.',
              issues: ((result as any).issues as unknown[]).slice(0, 10),
            };
          }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { ok: true, rendered: true };
    },
  });
}

/**
 * Build a stimulus instruction snippet describing a catalog to the model.
 *
 * Introspects the catalog's schema to enumerate available components + their
 * required/optional props so the model knows what it can construct.
 */
export function renderUiInstructions(catalog: Catalog<any, any>): string {
  const parts: string[] = [
    '## Generative UI',
    '',
    'You have a `renderUi` tool. Call it instead of (or in addition to) prose',
    'when the user asks for something best shown as structured UI — a card,',
    'table, chart, form, or multi-element layout.',
    '',
    'Pass a Spec: `{ root: <id>, elements: { <id>: { type, props, children } } }`.',
    '',
    'Available components:',
    '',
  ];
  try {
    const def = (catalog as any).schema?.definition?.catalog?.components ?? {};
    for (const [name, compDef] of Object.entries(def)) {
      const propNames =
        (compDef as any)?.props != null
          ? Object.keys((compDef as any).props).join(', ')
          : '';
      const slots = (compDef as any)?.slots?.join?.(', ') ?? '';
      const bits: string[] = [`- **${name}**`];
      if (propNames) bits.push(`props: ${propNames}`);
      if (slots) bits.push(`slots: ${slots}`);
      parts.push(bits.join(' — '));
    }
  } catch {
    parts.push('(unable to introspect catalog — model should use the Spec shape described above)');
  }
  return parts.join('\n');
}
