/**
 * Protects the deployment error log: it must name what failed without leaking credentials that
 * provider and database errors carry in messages, response bodies, headers or URLs.
 */
import { test, expect } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import { publicErrorHandler, safeErrorRecord, tagSandbox } from '../src/deployment/error-log.ts';

const SECRET = 'npg_supersecretvalue123';
const URL_WITH_SECRET = `postgresql://brain_owner:${SECRET}@ep-x.eu-central-1.aws.neon.tech/brain?sslmode=require`;

class APIError extends Error {
  response = { status: 409, headers: { authorization: `Bearer ${SECRET}` }, url: `https://api.vercel.com/x?token=${SECRET}` };
  json = { error: { code: 'drive_in_use', message: `held by ${SECRET}` } };
  text = `{"token":"${SECRET}"}`;
  sessionId = 'sbx_session_1';
}

test('keeps only fixed-shape identifiers from provider and database errors', () => {
  const provider = new APIError(`request failed for ${URL_WITH_SECRET}`);
  tagSandbox(provider, 'sbx_abc123');
  const record = safeErrorRecord(provider, 'drain.worker');
  expect(record).toMatchObject({ stage: 'drain.worker', error_class: 'APIError', code: 'drive_in_use', status: 409, sandbox: 'sbx_abc123', session: 'sbx_session_1' });
  const db = Object.assign(new Error(`connect ${URL_WITH_SECRET}`), { code: `bad ${SECRET} code` });
  for (const r of [record, safeErrorRecord(db, 'api.initialize'), safeErrorRecord(URL_WITH_SECRET, 'request')]) {
    expect(JSON.stringify(r)).not.toContain(SECRET);
  }
  expect(safeErrorRecord(db, 'api.initialize').code).toBeUndefined();
});

test('responds with a generic retryable 503 that carries the logged correlation id', async () => {
  const lines: string[] = [];
  const app = express();
  app.get('/boom', (_req, res) => { res.locals.stage = 'drain.worker'; throw new APIError(URL_WITH_SECRET); });
  app.use(publicErrorHandler(line => lines.push(line)));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    const response = await fetch(`http://127.0.0.1:${address.port}/boom`);
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(body).not.toContain(SECRET);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    const logged = JSON.parse(lines[0]!);
    expect(logged).toMatchObject({ event: 'gbrain_error', stage: 'drain.worker', code: 'drive_in_use' });
    expect(JSON.parse(body)).toEqual({ error: 'temporarily_unavailable', correlation_id: logged.correlation_id });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
