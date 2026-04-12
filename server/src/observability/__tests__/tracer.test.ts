// Tests for observability/tracer.ts.
//
// We exercise the AsyncLocalStorage-based nesting by actually running async
// work inside withEphemeralTrace / withSpan and inspecting the resulting
// span tree. No filesystem, no network.

import {
  withEphemeralTrace,
  withSpan,
  setSpanAttributes,
  currentSpanId,
} from '../tracer';

describe('observability/tracer', () => {
  test('root span is created and recorded', async () => {
    const { trace } = await withEphemeralTrace('root', async () => {
      return 42;
    });

    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].name).toBe('root');
    expect(trace.spans[0].parentId).toBeNull();
    expect(trace.rootId).toBe(trace.spans[0].id);
    expect(trace.spans[0].endMs).toBeDefined();
  });

  test('withSpan nests under the current span', async () => {
    const { trace } = await withEphemeralTrace('root', async () => {
      await withSpan('child', async () => {
        await withSpan('grandchild', async () => {
          return 1;
        });
      });
    });

    expect(trace.spans).toHaveLength(3);
    const root = trace.spans[0];
    const child = trace.spans.find(s => s.name === 'child')!;
    const grandchild = trace.spans.find(s => s.name === 'grandchild')!;

    expect(child.parentId).toBe(root.id);
    expect(grandchild.parentId).toBe(child.id);
  });

  test('sibling spans share a parent', async () => {
    const { trace } = await withEphemeralTrace('root', async () => {
      await withSpan('a', async () => {});
      await withSpan('b', async () => {});
    });

    const a = trace.spans.find(s => s.name === 'a')!;
    const b = trace.spans.find(s => s.name === 'b')!;
    expect(a.parentId).toBe(trace.rootId);
    expect(b.parentId).toBe(trace.rootId);
  });

  test('span records error and re-throws', async () => {
    await expect(
      withEphemeralTrace('root', async () => {
        await withSpan('failing', async () => {
          throw new Error('boom');
        });
      })
    ).rejects.toThrow('boom');
  });

  test('setSpanAttributes writes to the current span', async () => {
    const { trace } = await withEphemeralTrace('root', async () => {
      await withSpan('tagged', async () => {
        setSpanAttributes({ model: 'claude-sonnet-4-6', inputTokens: 12345 });
      });
    });

    const span = trace.spans.find(s => s.name === 'tagged')!;
    expect(span.attributes.model).toBe('claude-sonnet-4-6');
    expect(span.attributes.inputTokens).toBe(12345);
  });

  test('currentSpanId returns the innermost span id', async () => {
    await withEphemeralTrace('root', async () => {
      const rootId = currentSpanId();
      await withSpan('inner', async () => {
        const innerId = currentSpanId();
        expect(innerId).not.toBe(rootId);
      });
      // After the child finishes we should be back to the root.
      expect(currentSpanId()).toBe(rootId);
    });
  });

  test('withSpan outside a trace is a passthrough', async () => {
    // No active trace — withSpan should just run fn and not throw.
    const result = await withSpan('orphan', async () => 'ok');
    expect(result).toBe('ok');
    // setSpanAttributes outside a trace is a silent no-op, not an error.
    expect(() => setSpanAttributes({ foo: 'bar' })).not.toThrow();
  });

  test('concurrent spans inside one trace nest correctly via AsyncLocalStorage', async () => {
    // Two children run in parallel; both must nest under the root.
    const { trace } = await withEphemeralTrace('root', async () => {
      await Promise.all([
        withSpan('parallel-a', async () => {}),
        withSpan('parallel-b', async () => {}),
      ]);
    });
    const a = trace.spans.find(s => s.name === 'parallel-a')!;
    const b = trace.spans.find(s => s.name === 'parallel-b')!;
    expect(a.parentId).toBe(trace.rootId);
    expect(b.parentId).toBe(trace.rootId);
  });
});
