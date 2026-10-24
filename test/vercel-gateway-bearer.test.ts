/**
 * A warm Function outlives the deployment's OIDC token: every embedding call must send the
 * bearer current at call time, not the one the cached model was built with.
 */
import { test, expect, afterEach } from 'bun:test';
import { configureGateway, embed, resetGateway } from '../src/core/ai/gateway.ts';
import { setRequestBearer } from '../src/core/ai/request-bearer.ts';
import { gatewayBearer } from '../src/deployment/ai-gateway.ts';
import { withEnv } from './helpers/with-env.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetGateway(); });

test('each embedding call carries the bearer current at that call', async () => {
  const seen: (string | null)[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization'));
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.6, 0.8, 0] }], usage: { prompt_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  let token = 'oidc-1';
  configureGateway({ embedding_model: 'litellm:google/gemini-embedding-001', embedding_dimensions: 3, base_urls: { litellm: 'http://gateway.test/v1' }, env: {} });
  setRequestBearer({ recipeId: 'litellm', token: async () => token });
  await embed(['first']);
  token = 'oidc-2';
  await embed(['second']);
  expect(seen).toEqual(['Bearer oidc-1', 'Bearer oidc-2']);
});

test('a deployment bearer is the OIDC token of the current request; an explicit key overrides it', async () => {
  const slot = Symbol.for('@vercel/request-context');
  const g = globalThis as Record<symbol, unknown>;
  const previous = g[slot];
  let headers: Record<string, string> = {};
  g[slot] = { get: () => ({ headers }) };
  try {
    await withEnv({ LITELLM_API_KEY: undefined, VERCEL_OIDC_TOKEN: undefined }, async () => {
      headers = { 'x-vercel-oidc-token': token(1) };
      expect(await gatewayBearer()).toBe(token(1));
      headers = { 'x-vercel-oidc-token': token(2) };
      expect(await gatewayBearer()).toBe(token(2));
    });
    await withEnv({ LITELLM_API_KEY: 'explicit-key' }, async () => {
      expect(await gatewayBearer()).toBe('explicit-key');
    });
  } finally { g[slot] = previous; }
});

/** An unexpired unsigned JWT: @vercel/oidc only reads its exp. */
function token(n: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600, n })}.`;
}
