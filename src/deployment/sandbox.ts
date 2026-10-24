import { Drive, Sandbox } from '@vercel/sandbox';
import { requiredEnv } from './config.ts';

/** No arbitrary command or environment comes from an HTTP request. */
export async function runPublisherCommand(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const drive = await Drive.get({ name: requiredEnv('GBRAIN_SANDBOX_DRIVE') });
  const image = requiredEnv('GBRAIN_SANDBOX_IMAGE');
  if (!image.includes('@sha256:')) throw new Error('Pin GBRAIN_SANDBOX_IMAGE to an immutable image digest');
  const sandbox = await Sandbox.create({
    image, region: drive.region, persistent: false, timeout: 270_000,
    resources: { vcpus: 2 }, mounts: { '/data': drive },
  });
  try {
    const env: Record<string, string> = {
      GBRAIN_HOME: '/data', GBRAIN_DATABASE_URL: requiredEnv('GBRAIN_WORKER_DATABASE_URL'),
      GBRAIN_POOL_SIZE: '4', GBRAIN_PREPARE: 'false',
      GIT_TERMINAL_PROMPT: '0',
    };
    for (const key of ['GBRAIN_EMBEDDING_MODEL', 'GBRAIN_EMBEDDING_DIMENSIONS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'GBRAIN_GIT_TOKEN']) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    const command = await sandbox.runCommand({ cmd: '/usr/local/bin/bun', args, cwd: '/app', env, sudo: true });
    return { exitCode: command.exitCode, stdout: await command.stdout(), stderr: await command.stderr() };
  } finally {
    await sandbox.stop();
  }
}

export async function runSandboxWorker(): Promise<void> {
  const result = await runPublisherCommand(['--no-env-file', '/app/src/deployment/worker.ts']);
  if (result.exitCode !== 0) throw new Error(`Sandbox worker exited with code ${result.exitCode}; inspect Sandbox logs`);
}
