// Trace / span observability.
//
// P1-3 deliverable from CLAUDE.md. A minimal trace tree for evaluations:
//   - Each evaluate() call is a trace (one root span).
//   - Each role call, orchestrator debate, reflection, MREP verify, judge call,
//     and LLM HTTP call is a span nested under the root.
//   - Spans auto-nest via Node's AsyncLocalStorage — no caller needs to thread
//     a "context" argument. Wrap async work in withSpan() and any chat() call
//     it makes will hang a child span off the current span automatically.
//   - Finished traces are persisted to data/traces/<evaluationId>.json.
//
// This module has ZERO dependency on ai/client.ts — client.ts depends on
// tracer, not the other way around. That keeps the retry/usage plumbing
// isolated from observability concerns.

import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────

export interface Span {
  id: string;
  parentId: string | null;
  name: string;
  startMs: number;
  endMs?: number;
  /** Free-form attribute bag set by the caller or by chat(). */
  attributes: Record<string, string | number | boolean | undefined>;
  /** Error message if the span ended with a thrown exception. */
  error?: string;
}

export interface Trace {
  id: string;
  /** The evaluation this trace belongs to, if any. */
  evaluationId?: string;
  name: string;
  startMs: number;
  endMs?: number;
  spans: Span[];
  /** The root span ID — always the first span pushed into `spans`. */
  rootId: string;
}

/**
 * What AsyncLocalStorage carries through the async execution tree.
 * `trace` is the mutable Trace object (spans get pushed into it as they
 * complete). `currentSpanId` is the id of the currently-open span, used to
 * set parentId on newly opened children.
 */
interface TraceContext {
  trace: Trace;
  currentSpanId: string;
}

// ─── Internal state ─────────────────────────────────────────────────

const storage = new AsyncLocalStorage<TraceContext>();

// ─── Public API ─────────────────────────────────────────────────────

/** Start a new trace and run `fn` inside it. Returns fn's return value. */
export async function withTrace<T>(
  name: string,
  evaluationId: string | undefined,
  fn: () => Promise<T>,
  attributes: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const traceId = randomUUID();
  const rootSpanId = randomUUID();
  const startMs = Date.now();
  const rootSpan: Span = {
    id: rootSpanId,
    parentId: null,
    name,
    startMs,
    attributes: { ...attributes },
  };
  const trace: Trace = {
    id: traceId,
    evaluationId,
    name,
    startMs,
    spans: [rootSpan],
    rootId: rootSpanId,
  };

  const ctx: TraceContext = { trace, currentSpanId: rootSpanId };

  try {
    return await storage.run(ctx, async () => {
      try {
        return await fn();
      } catch (err) {
        rootSpan.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        rootSpan.endMs = Date.now();
        trace.endMs = Date.now();
      }
    });
  } finally {
    persistTrace(trace).catch(e => {
      // Trace persistence should never break the caller.
      console.error('[tracer] failed to persist trace', traceId, e);
    });
  }
}

/**
 * Run `fn` inside a new child span of the current span. If no trace is active,
 * `fn` is run without span tracking (the tracer is opt-in — code that runs
 * outside a withTrace() call just skips observability).
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) {
    // No active trace — execute without span tracking.
    return fn();
  }

  const spanId = randomUUID();
  const span: Span = {
    id: spanId,
    parentId: ctx.currentSpanId,
    name,
    startMs: Date.now(),
    attributes: { ...attributes },
  };
  ctx.trace.spans.push(span);

  // Push `spanId` as the new current span for anything `fn` calls.
  const childCtx: TraceContext = { trace: ctx.trace, currentSpanId: spanId };
  try {
    return await storage.run(childCtx, fn);
  } catch (err) {
    span.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    span.endMs = Date.now();
  }
}

/**
 * Set attributes on the currently-open span. No-op if no trace is active.
 * Used by chat() to annotate a span with model/token/usage info after the
 * LLM call returns.
 */
export function setSpanAttributes(
  attrs: Record<string, string | number | boolean | undefined>
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  const span = ctx.trace.spans.find(s => s.id === ctx.currentSpanId);
  if (!span) return;
  Object.assign(span.attributes, attrs);
}

/** Read the current trace context. Exposed for tests and advanced callers. */
export function currentTrace(): Trace | null {
  return storage.getStore()?.trace ?? null;
}

export function currentSpanId(): string | null {
  return storage.getStore()?.currentSpanId ?? null;
}

// ─── Persistence ────────────────────────────────────────────────────

const TRACE_DIR = path.join(process.cwd(), 'data', 'traces');

function ensureTraceDir(): void {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
}

async function persistTrace(trace: Trace): Promise<void> {
  // Only persist traces that belong to an evaluation. Anonymous traces
  // (tests, ad-hoc debugging) live in memory only.
  if (!trace.evaluationId) return;
  ensureTraceDir();
  const filePath = path.join(TRACE_DIR, `${trace.evaluationId}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(trace, null, 2), 'utf-8');
}

/** Read a persisted trace by evaluation ID. Returns null if none exists. */
export function readTrace(evaluationId: string): Trace | null {
  const filePath = path.join(TRACE_DIR, `${evaluationId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Trace;
  } catch {
    return null;
  }
}

// ─── Test hooks ─────────────────────────────────────────────────────

/**
 * Run `fn` inside a trace without persisting. Exposed for tests that want to
 * exercise span nesting without touching the filesystem.
 */
export async function withEphemeralTrace<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; trace: Trace }> {
  const traceId = randomUUID();
  const rootSpanId = randomUUID();
  const startMs = Date.now();
  const rootSpan: Span = {
    id: rootSpanId,
    parentId: null,
    name,
    startMs,
    attributes: {},
  };
  const trace: Trace = {
    id: traceId,
    name,
    startMs,
    spans: [rootSpan],
    rootId: rootSpanId,
  };
  const ctx: TraceContext = { trace, currentSpanId: rootSpanId };
  let result: T;
  try {
    result = await storage.run(ctx, async () => {
      try {
        return await fn();
      } finally {
        rootSpan.endMs = Date.now();
        trace.endMs = Date.now();
      }
    });
  } catch (err) {
    rootSpan.error = err instanceof Error ? err.message : String(err);
    throw err;
  }
  return { result, trace };
}
