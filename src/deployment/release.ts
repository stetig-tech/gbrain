/** Publisher code lives on the Drive, one directory per commit; the managed OS image carries no GBrain code. */
export const BUN_VERSION = '1.4.4';
export const BUN_BIN = `/data/tools/bun-${BUN_VERSION}/bin/bun`;
export const GIT_CREDENTIAL_HELPER = '/data/tools/git-credential.sh';
export const RELEASE_MANIFEST = '.gbrain-release.json';

export interface ReleaseManifest { sha: string; bun: string; lockfile_sha256: string; image: string }

export function releaseDir(sha: string): string { return `/data/app/${sha}`; }

function fullSha(name: string, value: string | undefined): string {
  const sha = value?.trim();
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${name} must be a full 40-character commit SHA`);
  return sha;
}

/** A deployed Function runs exactly its own commit; operators name the commit explicitly, never a branch. */
export function expectedReleaseSha(): string {
  if (process.env.VERCEL_DEPLOYMENT_ID) return fullSha('VERCEL_GIT_COMMIT_SHA', process.env.VERCEL_GIT_COMMIT_SHA);
  return fullSha('GBRAIN_RELEASE_SHA', process.env.GBRAIN_RELEASE_SHA);
}

export function assertReleaseManifest(raw: string, expected: { sha: string; image: string }): ReleaseManifest {
  let manifest: Partial<ReleaseManifest>;
  try { manifest = JSON.parse(raw); } catch { throw new Error(`Release ${expected.sha} is not installed on the Drive; run --install-release`); }
  if (manifest.sha !== expected.sha || manifest.bun !== BUN_VERSION || manifest.image !== expected.image || !manifest.lockfile_sha256) {
    throw new Error(`Release ${expected.sha} on the Drive does not match this deployment (image/Bun/commit); reinstall it explicitly`);
  }
  return manifest as ReleaseManifest;
}
