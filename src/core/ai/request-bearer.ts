let current: { recipeId: string; token: () => Promise<string> } | undefined;

/**
 * Authenticate one recipe's embedding calls with a bearer read at call time. A cached
 * model would otherwise keep the key it was built with, and a short-lived token (a
 * Vercel deployment's OIDC token) expires inside a warm process.
 */
export function setRequestBearer(bearer: { recipeId: string; token: () => Promise<string> } | undefined): void {
  current = bearer;
}

export function withRequestBearer(recipeId: string, inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const bearer = current;
    if (bearer?.recipeId !== recipeId) return inner(input, init);
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${await bearer.token()}`);
    return inner(input, { ...init, headers });
  }) as typeof fetch;
}
