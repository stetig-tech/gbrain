import { randomUUID } from 'node:crypto';
import type express from 'express';

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const sandboxNames = new WeakMap<object, string>();

/** Records which publisher Sandbox an error came from, without touching the error itself. */
export function tagSandbox(error: unknown, name: string): void {
  if (error && typeof error === 'object' && SAFE_TOKEN.test(name)) sandboxNames.set(error, name);
}

function safe(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
}

/**
 * Provider and database errors can carry credentials in their message, response body, headers or URL,
 * so only fixed-shape identifiers are copied out; the error object itself is never serialized.
 */
export function safeErrorRecord(error: unknown, stage: string): Record<string, string | number> {
  const record: Record<string, string | number> = { event: 'gbrain_error', correlation_id: randomUUID(), stage };
  if (!error || typeof error !== 'object') { record.error_class = typeof error; return record; }
  const e = error as Record<string, unknown> & { response?: { status?: unknown }; json?: { error?: { code?: unknown } } };
  record.error_class = safe(error.constructor?.name) ?? 'unknown';
  const code = safe(e.json?.error?.code) ?? safe(e.code);
  if (code) record.code = code;
  const status = typeof e.response?.status === 'number' ? e.response.status : e.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600) record.status = status;
  const sandbox = sandboxNames.get(error) ?? safe(e.sandboxName);
  if (sandbox) record.sandbox = sandbox;
  const session = safe(e.sessionId);
  if (session) record.session = session;
  return record;
}

export function publicErrorHandler(log: (line: string) => void = line => console.error(line)): express.ErrorRequestHandler {
  return (error, _req, res, _next) => {
    const record = safeErrorRecord(error, typeof res.locals.stage === 'string' ? res.locals.stage : 'request');
    log(JSON.stringify(record));
    if (res.headersSent) return;
    res.set('Retry-After', '60').status(503).json({ error: 'temporarily_unavailable', correlation_id: record.correlation_id });
  };
}
