# Vercel MCP + Neon + Sandbox publisher

This fork runs the existing authenticated MCP transport on Vercel Functions (Bun
1.4.x). It keeps GBrain's managed-write journal, publication guards and Git
outbox. The API admits writes into Neon; it cannot elect a local publisher.
A protected Cron route starts a bounded Sandbox when the journal has work.

```text
MCP client → Vercel /mcp → Neon requests and receipts
                           ↑
Vercel Cron → Sandbox publisher → /data/brain → Git remote
                           └── /data/.gbrain (persistent owner identity)
```

The Drive holds the whole `/data` directory, including checkout, `.git`, owner
identity and sibling coordination/ownership files. Never store only the Markdown
files or clone the checkout afresh for every invocation. Drives allow one
read-write Sandbox mount at a time. A conflicting invocation fails and the next
Cron retries durable work. No in-memory queue or detached HTTP task is used.

## Supported deployment surface

- Authenticated Streamable HTTP `/mcp`, OAuth `/token` and `/revoke`, discovery.
- Starter memory/document tools, including durable write-receipt tools. The same
  scope, source, private-page and principal checks apply as upstream.
- Managed publication, recovery, Git and embedding effects in the Sandbox.
- No resident admin UI, interactive OAuth consent/DCR, GitHub webhook or resident
  agent job runner. `submit_agent`, its job controls, tool-surface expansion and
  local skill-sync tools are omitted. ATIS runs its own agent and calls MCP.
- GitHub pushes from *outside* this publisher are not automatically imported.
  Run upstream sync explicitly in the publisher Sandbox when needed. Arbitrary
  background workflows/minion execution are not implemented by this worker.

The default Cron interval is five minutes (requires a Vercel plan supporting
that cadence). Writes may return `write_pending`: preserve `request_id` and
poll `get_write_request`. Do not treat acceptance as a Git push. The publisher
stops when the journal is empty or after 210 seconds of processing; shutdown has
60 seconds before the Sandbox's 270-second hard limit. The Function limit is
300 seconds. Expired claims/recovery are handled by the next invocation.

## Create resources

1. Create a **separate Vercel project** linked to this fork. Root directory is the
   repository root; use the checked-in Express configuration. Keep automatic
   production deployments disabled until the checks below pass.
2. Create a dedicated Neon database/branch near `fra1`, with `vector`, `pg_trgm`
   and `pgcrypto` available. Use the pooled URL for `GBRAIN_DATABASE_URL` and the
   direct URL for `GBRAIN_WORKER_DATABASE_URL`. Do not reuse ATIS application
   tables/schema. Runtime API instances use two connections; workers use four.
3. The publisher runs on a Vercel Managed Image pinned by digest; no custom image
   or registry is involved. Resolve the current digest of
   `vercel/sandbox/universal` (a probe `Sandbox.create` reports it) and set
   `GBRAIN_SANDBOX_IMAGE=vercel/sandbox/universal@sha256:…`. GBrain code and Bun
   1.4.4 are installed onto the Drive per commit by an explicit step (below), so
   the Function and the publisher always run the same commit.
4. Set environment variables using `deploy/vercel/.env.example` as the checklist.
   Set embedding model/dimensions consistently before initializing the schema.
   `GBRAIN_GIT_TOKEN` is a fine-grained GitHub token scoped to the **knowledge**
   repository with contents read/write. This is separate from the GBrain code
   fork. The canonical knowledge repository must have an initial commit and a
   writable tracking branch. Secrets belong in Vercel settings, never Git.
5. For local administration, `vercel link` to the intended project and
   `vercel env pull .env.local`; use the Vercel OIDC credentials supplied by that
   workflow. Refresh them when expired. Run the following from this checkout:

   ```sh
   bun --env-file=.env.local scripts/vercel-admin.ts --create-drive
   ```

   Default Drive region is `fra1`; set `GBRAIN_SANDBOX_REGION` before creation to
   change it. Drive and Sandbox region must match. The runtime retrieves the
   existing Drive and never silently creates a replacement.

## Initialize inside the publisher Sandbox

The commands below use the same image, mount path, direct database connection
and Git credential helper as the worker. They are explicit operator commands;
HTTP callers cannot execute arbitrary commands. Do not run ownership commands
from your laptop against the production database.

Define a local helper (it passes arguments directly to Bun in the Sandbox, inside
`/data/app/<GBRAIN_RELEASE_SHA>`). Name the deployed commit explicitly; there is no
branch or "latest" default:

```sh
export GBRAIN_RELEASE_SHA=$(git rev-parse HEAD)   # must equal the deployment's commit
publisher() { bun --env-file=.env.local scripts/vercel-admin.ts "$@"; }
brain() { publisher --no-env-file src/cli.ts "$@"; }
```

Install the release onto the Drive. It verifies Bun's release checksum, fetches
exactly that commit, runs `bun install --frozen-lockfile`, smoke-tests native
locks and writes `/data/app/<sha>/.gbrain-release.json` last. The worker refuses
to run when that manifest is missing or names another commit, Bun or image; it
never installs on demand. Install each new commit **before** its deployment
receives Cron traffic. Older release directories stay for rollback.

```sh
publisher --install-release
```

Initialize the database and checkout (preview: pass an isolated tracking branch
as the second argument so verification never publishes to the live branch):

```sh
publisher --no-env-file scripts/vercel-init-db.ts
publisher --no-env-file scripts/vercel-init-worktree.ts https://github.com/OWNER/KNOWLEDGE.git [BRANCH]
brain sources set-path default /data/brain
brain config set sync.repo_path /data/brain
brain config set sync.write_through true
brain sources writer status --json
```

For an existing brain, first take a database backup and follow upstream migration
instructions; the init helper is intended for a fresh dedicated database.

GBrain binds administrative mutations to a reviewed topology fingerprint. Copy
`admin_state` from the latest status into each command below, reviewing status
again after each mutation. Do not recycle an old fingerprint or bypass the guard:

```sh
brain sources writer claim default --path /data/brain --dry-run --json
brain sources writer claim default --path /data/brain --admin-intent writer_claim --expected-state CURRENT_ADMIN_STATE
brain sources writer status --json
brain sources writer activate --confirm-quiesced --admin-intent writer_activate --expected-state CURRENT_ADMIN_STATE
brain sources writer status --json
brain sources writer git-durability default --enable --admin-intent writer_git_durability --expected-state CURRENT_ADMIN_STATE
brain sync
brain sources writer status default --probe --json
```

`--confirm-quiesced` means no older GBrain process is writing this database.
If any command returns a state-bound remediation, follow that command and read
status again. Do not erase ownership markers or force-rebind on a failed probe.
The Git credential helper reads `GBRAIN_GIT_TOKEN` at execution time and only
answers for `https://github.com`; the token is not written to the Drive.

For the first deployment, create a scoped bearer token (the tested local path):

```sh
brain auth create mcp-client --scopes read,write
```

Store the returned token in the MCP caller's secret store and send it as
`Authorization: Bearer ...` to `https://YOUR_DOMAIN/mcp`.

Confidential OAuth is also wired through the upstream provider, but its existing
registration tests fail on the unmodified base; verify this path on Neon before
relying on it (see [validation record](VALIDATION.md)). To register that client:

```sh
brain auth register-client mcp-client --grant-types client_credentials --scopes read,write
```

Save its returned client ID and secret in the MCP caller's secret store. Exchange
credentials at `/token` with `grant_type=client_credentials`; send the resulting
bearer token to `https://YOUR_DOMAIN/mcp`. A scoped bearer token created with
upstream `auth create` is also supported. No admin bootstrap token is needed.

## Before production traffic

1. Deploy a preview using its **own Neon branch and Drive**, its own issuer and
   secrets. Preview is refused unless `GBRAIN_ALLOW_PREVIEW=1` is explicitly set.
   Cron is normally production-only; invoke `/internal/drain` manually with
   `Authorization: Bearer <CRON_SECRET>` for the preview test.
2. Check `/health`, unauthenticated `/mcp` → 401, authenticated initialize and
   tools/list. Check client scopes and source isolation.
3. Write with a fixed request ID while the publisher is stopped. Observe pending,
   invoke drain, then verify receipt, search result, canonical file and remote
   Git commit. Repeat the same request ID: no duplicate write/commit.
4. Stop the Sandbox and start another on the same Drive. Verify writer status,
   native locks and physical-root identity, then publish another change. This
   real-cloud gate matters: a local test cannot prove Drive inode/birth-time
   behavior or crash durability. Never bypass physical-root checks to pass it.
5. Test concurrent drain calls, interrupted publication, revoked credentials,
   failed Git push/retry and stale embedding completion. Verify recovery and
   that another source's files cannot change.
6. Enable production Git deployments and Cron only after these checks pass.

## Validation and operations

```sh
bun install --frozen-lockfile
bun run typecheck
bun --no-env-file test test/vercel-external-consumer.test.ts test/vercel-http.test.ts
bun run verify
```

`vercel-check.yml` additionally syntax-checks the release installer in GitHub CI.
Local tests cover transport/auth, absence of resident endpoints and admission
versus publication. They do not substitute for a Neon/Vercel integration run.
The Vercel framework build must also pass after linking the project; a Bun bundle
smoke check alone does not validate Vercel packaging or platform limits.

Monitor Cron failures, old queued requests, failed/recovering receipts and Git
outbox outcomes. A blocked write may need operator action, not endless retries.
`brain sources writer status --probe --json` is the first diagnostic. Back up
**both Neon and the Drive**; Git alone omits database-only and operational state.
On rollback, stop admissions/cron first, preserve the Drive, and use a code release (already on the Drive) and image
version compatible with the current schema and mutation protocol.

Official platform references: [Bun Functions](https://vercel.com/docs/functions/runtimes/bun),
[Express](https://vercel.com/docs/frameworks/backend/express),
[Sandbox Drives](https://vercel.com/docs/sandbox/concepts/drives).
