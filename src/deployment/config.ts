/** Explicit deployment inputs; never infer a production database from a preview URL. */
export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function publicUrl(): string {
  const url = new URL(requiredEnv('GBRAIN_PUBLIC_URL'));
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('GBRAIN_PUBLIC_URL must be an HTTPS origin');
  }
  return url.origin;
}
export function assertDeploymentEnvironment(): void {
  if (process.env.VERCEL_ENV === 'preview' && process.env.GBRAIN_ALLOW_PREVIEW !== '1') {
    throw new Error('Preview disabled: provision an isolated database and Drive before setting GBRAIN_ALLOW_PREVIEW=1');
  }
}
