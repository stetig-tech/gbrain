/** Explicit, one-time initialization inside the publisher Sandbox. Never replaces a checkout. */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GIT_CREDENTIAL_HELPER } from '../src/deployment/release.ts';
const [raw, branch] = process.argv.slice(2);
if (!raw) throw new Error('Usage: vercel-init-worktree.ts https://github.com/OWNER/KNOWLEDGE.git [tracking-branch]');
const repo = new URL(raw);
if (repo.protocol !== 'https:' || repo.hostname !== 'github.com' || repo.username || repo.password || repo.search || repo.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(repo.pathname)) {
  throw new Error('Expected a credential-free GitHub HTTPS repository URL');
}
if (branch !== undefined && !/^[\w.-]+(?:\/[\w.-]+)*$/.test(branch)) throw new Error('Invalid tracking branch name');
if (process.env.GBRAIN_HOME !== '/data' || existsSync('/data/brain')) throw new Error('Expected an unused /data/brain on the publisher Drive');
if (!existsSync(GIT_CREDENTIAL_HELPER)) throw new Error('Install a release first; it provides the Git credential helper');
const git = (...a: string[]) => execFileSync('git', a, { stdio: 'inherit' });
git('-c', `credential.helper=${GIT_CREDENTIAL_HELPER}`, 'clone', '--', repo.toString(), '/data/brain');
for (const [key, value] of [['credential.helper', GIT_CREDENTIAL_HELPER], ['user.name', 'GBrain Publisher'], ['user.email', 'gbrain-publisher@example.invalid']]) {
  git('-C', '/data/brain', 'config', '--local', key!, value!);
}
// An isolated branch keeps verification publications away from the live default branch.
if (branch) {
  const remote = execFileSync('git', ['-C', '/data/brain', 'ls-remote', '--heads', 'origin', branch], { encoding: 'utf8' }).trim();
  if (remote) git('-C', '/data/brain', 'checkout', '--track', '-b', branch, `origin/${branch}`);
  else { git('-C', '/data/brain', 'checkout', '-b', branch); git('-C', '/data/brain', 'push', '--set-upstream', 'origin', branch); }
}
console.log('Checkout created at /data/brain. Next: configure the source, claim it, and activate managed persistence.');
