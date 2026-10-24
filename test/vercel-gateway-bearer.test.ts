/**
 * A warm Function outlives the deployment's OIDC token: every embedding call must send the
 * bearer current at call time, not the one the cached model was built with.
 */
import { test, expect, afterEach } from 'bun:test';
import { configureGateway, embed, resetGateway } from '../src/core/ai/gateway.ts';
import { setRequestBearer } from '../src/core/ai/request-bearer.ts';

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
