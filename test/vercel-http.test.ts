/**
 * Protects the serverless HTTP surface: bearer MCP still works, resident/admin routes stay absent.
 * Regression: mounting the full server exposes per-process admin/consent/webhook state.
 * Existing serve tests exercise the resident app, not this mode. Uses real HTTP and PGLite, no new seam.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { buildServeHttpApp } from '../src/commands/serve-http.ts';
import { mintLegacyToken } from '../src/core/token-mint.ts';
import { withEnv } from './helpers/with-env.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let engine: PGLiteEngine;
beforeAll(async () => { engine = new PGLiteEngine(); await engine.connect({}); await engine.initSchema(); }, 60_000);
afterAll(async () => { await engine.disconnect(); });

test('serverless MCP verifies bearer tokens without mounting resident HTTP routes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gbrain-vercel-test-'));
  try { await withEnv({ GBRAIN_HOME: home, GBRAIN_DATABASE_URL: undefined, DATABASE_URL: undefined }, async () => {
    const app = express();
    let server: Server | undefined;
    try {
      await buildServeHttpApp(app, engine, { port: 3000, tokenTtl: 3600, enableDcr: false, serverless: true, surface: 'starter', suppressBootstrapToken: true });
      server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No TCP address');
      const base = `http://127.0.0.1:${address.port}`;
      for (const path of ['/admin', '/admin/login', '/authorize', '/register', '/webhooks/github']) {
        expect((await fetch(`${base}${path}`, { method: 'POST' })).status).toBe(404);
      }
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect((await fetch(`${base}/mcp`, { method: 'POST', headers, body })).status).toBe(401);
      const { token } = await mintLegacyToken(engine, { name: 'fixture-mcp', scopes: ['read', 'write'], takesHolders: ['world'], sourceGrant: ['default'] });
      const result = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body });
      expect(result.status).toBe(200);
      const text = await result.text();
      const data = text.split('\n').find(line => line.startsWith('data:'))?.slice(5) ?? text;
      const names = JSON.parse(data).result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain('get_write_request');
      expect(names).not.toContain('submit_agent');
      const discovery = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
      expect(discovery.grant_types_supported).toEqual(['client_credentials']);
      expect(discovery.authorization_endpoint).toBeUndefined();
    } finally {
      if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    }
  }); } finally { rmSync(home, { recursive: true, force: true }); }
}, 60_000);
