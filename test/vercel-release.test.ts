/**
 * Protects the publisher release gate: a deployment never runs code from a different commit, Bun or image on the Drive.
 */
import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertReleaseManifest, expectedReleaseSha, BUN_VERSION } from '../src/deployment/release.ts';
import { withEnv } from './helpers/with-env.ts';

const sha = 'a'.repeat(40), image = 'vercel/sandbox/universal@sha256:' + 'b'.repeat(64);
const manifest = (over: object = {}) => JSON.stringify({ sha, bun: BUN_VERSION, lockfile_sha256: 'c'.repeat(64), image, ...over });

test('accepts only the manifest of the expected commit, Bun and image', () => {
  expect(assertReleaseManifest(manifest(), { sha, image }).sha).toBe(sha);
  for (const bad of ['', '{', manifest({ sha: 'd'.repeat(40) }), manifest({ bun: '1.4.3' }), manifest({ image: 'other@sha256:x' }), manifest({ lockfile_sha256: '' })]) {
    expect(() => assertReleaseManifest(bad, { sha, image })).toThrow();
  }
});

test('deployed Functions use their own commit; operators must name a full SHA', async () => {
  await withEnv({ VERCEL_DEPLOYMENT_ID: 'dpl_x', VERCEL_GIT_COMMIT_SHA: sha, GBRAIN_RELEASE_SHA: 'e'.repeat(40) }, async () => {
    expect(expectedReleaseSha()).toBe(sha);
  });
  await withEnv({ VERCEL_DEPLOYMENT_ID: undefined, VERCEL_GIT_COMMIT_SHA: undefined, GBRAIN_RELEASE_SHA: 'main' }, async () => {
    expect(() => expectedReleaseSha()).toThrow();
  });
  await withEnv({ VERCEL_DEPLOYMENT_ID: 'dpl_x', VERCEL_GIT_COMMIT_SHA: undefined, GBRAIN_RELEASE_SHA: sha }, async () => {
    expect(() => expectedReleaseSha()).toThrow();
  });
});

test('install-release reuses only a matching release and reinstalls a mismatched or corrupted one', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-release-')), src = join(root, 'src');
  const git = (...a: string[]) => execFileSync('git', ['-C', src, ...a], { encoding: 'utf8' }).trim();
  mkdirSync(join(src, 'deploy/vercel'), { recursive: true });
  writeFileSync(join(src, 'bun.lock'), '{}\n');
  writeFileSync(join(src, 'deploy/vercel/git-credential.sh'), '#!/bin/sh\n');
  git('init', '-q'); git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'r');
  const commit = git('rev-parse', 'HEAD');
  const bin = join(root, `tools/bun-${BUN_VERSION}/bin`);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'bun'), `#!/bin/sh\n[ "$1" = --version ] && echo ${BUN_VERSION}\nexit 0\n`, { mode: 0o755 });
  const release = join(root, 'app', commit), manifestPath = join(release, '.gbrain-release.json'), marker = join(release, 'marker');
  const install = (img: string) => execFileSync('bash', ['deploy/vercel/install-release.sh', commit, img], {
    env: { PATH: process.env.PATH, HOME: root, GBRAIN_INSTALL_ROOT: root, GBRAIN_INSTALL_REPO: src }, stdio: 'pipe',
  });
  const imageB = 'vercel/sandbox/universal@sha256:' + 'f'.repeat(64);
  try {
    install(image);
    expect(assertReleaseManifest(readFileSync(manifestPath, 'utf8'), { sha: commit, image }).sha).toBe(commit);
    writeFileSync(marker, '');
    install(image);
    expect(existsSync(marker)).toBe(true);
    install(imageB);
    expect(existsSync(marker)).toBe(false);
    expect(assertReleaseManifest(readFileSync(manifestPath, 'utf8'), { sha: commit, image: imageB }).image).toBe(imageB);
    writeFileSync(manifestPath, '{');
    install(imageB);
    expect(assertReleaseManifest(readFileSync(manifestPath, 'utf8'), { sha: commit, image: imageB }).sha).toBe(commit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
