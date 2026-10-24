/** Explicit operator entrypoint, never reachable over HTTP. Uses the exact worker image and Drive. */
import { Drive } from '@vercel/sandbox';
import { requiredEnv } from '../src/deployment/config.ts';
import { runPublisherCommand } from '../src/deployment/sandbox.ts';

const args = process.argv.slice(2);
if (!args.length) throw new Error('Usage: bun scripts/vercel-admin.ts <Bun arguments>; --create-drive creates the persistent Drive');
if (args[0] === '--create-drive') {
  const drive = await Drive.getOrCreate({ name: requiredEnv('GBRAIN_SANDBOX_DRIVE'), region: process.env.GBRAIN_SANDBOX_REGION ?? 'fra1' });
  console.log(JSON.stringify({ name: drive.name, region: drive.region }));
} else {
  const result = await runPublisherCommand(args);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
