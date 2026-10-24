# Validation record

## Real-cloud preview, 2026-10-24

Vercel project `gbrain` (team stetig, fra1), Bun 1.4.4 Function, Neon branch
`preview` (PG17, eu-central-1), Sandbox Drive `brain-preview`, managed image
`vercel/sandbox/universal@sha256:3190aee7…df949`, knowledge repo
`stetig-tech/stetig-knowledge` on the isolated branch `gbrain-preview` (`main`
untouched). Release installed on the Drive per commit; last checked deploy
`45c1950fe`. Production, Cron and the production domain were not enabled.

Passed:

- Release gate: `--install-release` installs Bun (checksum) and the commit; the
  fast path accepts only an exact manifest, HEAD and clean tree, otherwise it
  reinstalls that release directory. Native lock capability `linux-x64-glibc`.
- Provisioning in the Sandbox: init-db (264 migrations), init-worktree with a
  tracking branch, claim → activate → git-durability with fresh `admin_state`,
  `sync --no-embed` (92 pages).
- `/health` 200; `/mcp` without token 401; `/internal/drain` without
  `CRON_SECRET` 401; MCP initialize and tools/list (27 tools).
- `put_page` with a fixed request ID → queued → drain → receipt committed, file
  written, commit by the publisher on the remote branch, keyword search hit.
  Replay with the same request ID: same revision, idle drain, no new commit.
- Fresh-Sandbox identity: every drain is a new non-persistent Sandbox on the same
  Drive; owner host and epoch unchanged, binding active. The Function appears in
  writer versions as the admitter (`admitter_host_id`), the Sandbox as consumer.
- Concurrent drains: one publishes, the other gets 503; the safe error log shows
  `APIError code=drive_attached status=409` (Drive already mounted). One commit.
- Revoked token 401; read-only token gets `insufficient_scope` on writes.
- Source isolation: a database-only preview source and two tokens scoped to one
  source each; cross-source get/search/write/receipt/list were refused or empty,
  neither page changed, no files reached Git. Temporary source tokens revoked.
- Failed push: an invalid Git token parks the Git effect (`targets_parked`) while
  the file is written. Drain reports `git_held` and logs `gbrain_git_held`;
  `retry-effects default --parked-pushes` then drain publishes and clears it.
- Interrupted publication (`vercel sandbox stop` mid-drain): requests stayed
  durable; the next drain published every write once (10/10 files). The stopped
  drain answers 503 (`worker_exit_143`) or 202 `backlog_remaining`.

Found and fixed during the run: Express builder detection (`buildCommand`),
`.ts` import specifiers in the traced Function (`rewriteRelativeImportExtensions`),
`pkce-challenge` missing from the Bun trace (patched `bun` export condition; the
only such package), the persistence consumer treating the direct worker URL as a
pooler (`GBRAIN_DIRECT_DATABASE_URL`), a drain reporting `completed` with work
left, held Git publication reported as idle, and errors leaving no evidence (safe
structured log).

Not yet validated:

- Embeddings: no `OPENAI_API_KEY` yet. Existing pages record the embedding effect
  as skipped (`embedding_unconfigured`); after the key, run the supported
  backfill and check vector retrieval and stale-embedding completion.
- Production deployment, custom domain (Deployment Protection), Cron.
- Confidential OAuth client registration (`serve-http-auth-outcomes.test.ts`
  5 passed / 6 failed, identical on the base commit); scoped bearer MCP is the
  tested path.
- The very first Git deployment of the new project was created with target
  production from the feature branch (production branch `master`); it failed to
  build. Later deployments of the branch were previews. Cause not established.

## Local

`bun run typecheck`, `bun run verify` (89/89) and the Vercel tests pass. The full
upstream unit/serial/E2E suite was not run.
