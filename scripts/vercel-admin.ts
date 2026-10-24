/** Explicit operator entrypoint, never reachable over HTTP. Uses the worker's pinned image, release and Drive. */
import { Drive } from '@vercel/sandbox';
import { execFileSync } from 'node:child_process';
import { requiredEnv } from '../src/deployment/config.ts';
import { expectedReleaseSha } from '../src/deployment/release.ts';
import { runPublisherCommand, sandboxImage, withPublisherSandbox } from '../src/deployment/sandbox.ts';

const args = process.argv.slice(2);
if (!args.length) throw new Error('Usage: bun scripts/vercel-admin.ts --create-drive | --install-release | <Bun arguments run in the release directory>');
if (args[0] === '--create-drive') {
  const drive = await Drive.getOrCreate({ name: requiredEnv('GBRAIN_SANDBOX_DRIVE'), region: process.env.GBRAIN_SANDBOX_REGION ?? 'fra1' });
  console.log(JSON.stringify({ name: drive.name, region: drive.region }));
} else if (args[0] === '--install-release') {
  const sha = expectedReleaseSha();
  // The installer comes from the same commit it installs, never from the working tree.
  const script = execFileSync('git', ['show', `${sha}:deploy/vercel/install-release.sh`]);
  const code = await withPublisherSandbox(async sandbox => {
    await sandbox.writeFiles([{ path: '/tmp/install-release.sh', content: script }]);
    const command = await sandbox.runCommand({ cmd: 'bash', args: ['/tmp/install-release.sh', sha, sandboxImage()], sudo: true });
    process.stdout.write(await command.stdout()); process.stderr.write(await command.stderr());
    return command.exitCode;
  });
  process.exitCode = code;
} else {
  const result = await runPublisherCommand(args);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
