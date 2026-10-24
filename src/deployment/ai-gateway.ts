import { getVercelOidcToken } from '@vercel/oidc';
import type { BrainEngine } from '../core/engine.ts';
import type { GBrainConfig } from '../core/config.ts';
import { buildGatewayConfig } from '../core/ai/build-gateway-config.ts';
import { configureGateway, reconfigureGatewayWithEngine } from '../core/ai/gateway.ts';
import { setRequestBearer } from '../core/ai/request-bearer.ts';

/** An explicit key (local admin) wins; a deployment authenticates AI Gateway with its own OIDC token, read fresh each time. */
export function gatewayBearer(): Promise<string> {
  const key = process.env.LITELLM_API_KEY;
  return key ? Promise.resolve(key) : getVercelOidcToken();
}

/** Without a configured gateway the persistence consumer settles every embedding effect as skipped. */
export async function configureDeploymentGateway(engine: BrainEngine, config: GBrainConfig): Promise<void> {
  // A warm Function outlives an OIDC token, so the bearer is resolved per call, in that request's context.
  setRequestBearer({ recipeId: 'litellm', token: gatewayBearer });
  configureGateway(buildGatewayConfig(config));
  await reconfigureGatewayWithEngine(engine);
}
