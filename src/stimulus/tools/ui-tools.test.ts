import { describe, it, expect } from 'vitest';
import { makeRenderUiTool, renderUiInstructions } from './ui-tools.js';

describe('makeRenderUiTool', () => {
  it('exposes a tool with the json-render Spec inputSchema', () => {
    const t = makeRenderUiTool();
    expect(t.inputSchema).toBeDefined();
    const parsed = (t.inputSchema as any).safeParse({
      root: 'a',
      elements: {
        a: { type: 'Card', props: { title: 'hi' }, children: [] },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects malformed specs at the inputSchema layer', () => {
    const t = makeRenderUiTool();
    const parsed = (t.inputSchema as any).safeParse({
      // Missing `elements`
      root: 'a',
    });
    expect(parsed.success).toBe(false);
  });

  it('returns { ok: true, rendered: true } on happy-path spec (no catalog)', async () => {
    const t = makeRenderUiTool();
    const result = await (t.execute as any)(
      {
        root: 'a',
        elements: {
          a: { type: 'Card', props: { title: 'Hello' }, children: [] },
        },
      },
      { toolCallId: 'tc-1', messages: [] },
    );
    expect(result.ok).toBe(true);
    expect(result.rendered).toBe(true);
  });

  it('accepts a custom description', () => {
    const t = makeRenderUiTool({ description: 'only render when asked' });
    expect(t.description).toBe('only render when asked');
  });
});

describe('renderUiInstructions', () => {
  it('produces a non-empty instruction string from a minimal catalog stub', () => {
    // We don't want this test to depend on the full @json-render builder API
    // (which lives in @json-render/react). The function only reads
    // catalog.schema.definition.catalog.components, so a stub is fine.
    const catalogStub = {
      schema: {
        definition: {
          catalog: {
            components: {
              Card: { props: { title: {} }, slots: ['default'] },
              Text: { props: { value: {} } },
            },
          },
        },
      },
    } as any;
    const s = renderUiInstructions(catalogStub);
    expect(typeof s).toBe('string');
    expect(s).toContain('renderUi');
    expect(s).toContain('Card');
    expect(s).toContain('title');
    expect(s).toContain('Text');
    expect(s).toContain('value');
  });
});
