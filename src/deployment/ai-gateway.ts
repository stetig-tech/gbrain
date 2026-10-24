import { getVercelOidcToken } from '@vercel/oidc';

/** An explicit key (local admin) wins; a deployment authenticates AI Gateway with its own OIDC token, read fresh each time. */
export function gatewayBearer(): Promise<string> {
  const key = process.env.LITELLM_API_KEY;
  return key ? Promise.resolve(key) : getVercelOidcToken();
}
