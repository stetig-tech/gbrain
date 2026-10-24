import { Drive, Sandbox } from '@vercel/sandbox';
import { requiredEnv } from './config.ts';
import { tagSandbox } from './error-log.ts';
import { BUN_BIN, RELEASE_MANIFEST, assertReleaseManifest, expectedReleaseSha, releaseDir } from './release.ts';

export function sandboxImage(): string {
  const image = requiredEnv('GBRAIN_SANDBOX_IMAGE');
  if (!image.includes('@sha256:')) throw new Error('Pin GBRAIN_SANDBOX_IMAGE to an immutable image digest');
  return image;
}

export async function withPublisherSandbox<T>(run: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  const drive = await Drive.get({ name: requiredEnv('GBRAIN_SANDBOX_DRIVE') });
  const sandbox = await Sandbox.create({
    image: sandboxImage(), region: drive.region, persistent: false, timeout: 270_000,
    resources: { vcpus: 2 }, mounts: { '/data': drive },
  });
  try { return await run(sandbox); } catch (error) { tagSandbox(error, sandbox.name); throw error; } finally { await sandbox.stop(); }
}

/** No arbitrary command or environment comes from an HTTP request. */
export async function runPublisherCommand(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const sha = expectedReleaseSha();
  const cwd = releaseDir(sha);
  return withPublisherSandbox(async sandbox => {
    // Code is never installed on demand: a missing or mismatched release fails before any publication.
    const manifest = await sandbox.runCommand({ cmd: 'cat', args: [`${cwd}/${RELEASE_MANIFEST}`], sudo: true });
    assertReleaseManifest(manifest.exitCode === 0 ? await manifest.stdout() : '', { sha, image: sandboxImage() });
    const workerUrl = requiredEnv('GBRAIN_WORKER_DATABASE_URL');
    // prepare=false alone reads as a transaction pooler; the explicit direct route keeps persistence off that lane.
    const env: Record<string, string> = {
      GBRAIN_HOME: '/data', GBRAIN_DATABASE_URL: workerUrl, GBRAIN_DIRECT_DATABASE_URL: workerUrl,
      GBRAIN_POOL_SIZE: '4', GBRAIN_PREPARE: 'false',
      GIT_TERMINAL_PROMPT: '0', PATH: `${BUN_BIN.slice(0, -'/bun'.length)}:/usr/local/bin:/usr/bin:/bin`,
    };
    for (const key of ['GBRAIN_EMBEDDING_MODEL', 'GBRAIN_EMBEDDING_DIMENSIONS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'LITELLM_BASE_URL', 'LITELLM_API_KEY', 'GBRAIN_GIT_TOKEN']) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    const command = await sandbox.runCommand({ cmd: BUN_BIN, args, cwd, env, sudo: true });
    return { exitCode: command.exitCode, stdout: await command.stdout(), stderr: await command.stderr() };
  });
}

export async function runSandboxWorker(): Promise<void> {
  const result = await runPublisherCommand(['--no-env-file', 'src/deployment/worker.ts']);
  if (result.exitCode !== 0) throw Object.assign(new Error(`Sandbox worker exited with code ${result.exitCode}; inspect Sandbox logs`), { code: `worker_exit_${result.exitCode}` });
}
