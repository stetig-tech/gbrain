/** Explicit, one-time initialization inside the publisher Sandbox. Never replaces a checkout. */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const raw = process.argv[2];
if (!raw) throw new Error('Usage: vercel-init-worktree.ts https://github.com/OWNER/KNOWLEDGE.git');
const repo = new URL(raw);
if (repo.protocol !== 'https:' || repo.hostname !== 'github.com' || repo.username || repo.password || repo.search || repo.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(repo.pathname)) {
  throw new Error('Expected a credential-free GitHub HTTPS repository URL');
}
if (process.env.GBRAIN_HOME !== '/data' || existsSync('/data/brain')) throw new Error('Expected an unused /data/brain on the publisher Drive');
const helper = '/app/deploy/vercel/git-credential.sh';
execFileSync('git', ['-c', `credential.helper=${helper}`, 'clone', '--', repo.toString(), '/data/brain'], { stdio: 'inherit' });
for (const [key, value] of [['credential.helper', helper], ['user.name', 'GBrain Publisher'], ['user.email', 'gbrain-publisher@example.invalid']]) {
  execFileSync('git', ['-C', '/data/brain', 'config', '--local', key!, value!], { stdio: 'inherit' });
}
console.log('Checkout created at /data/brain. Next: configure the source, claim it, and activate managed persistence.');
