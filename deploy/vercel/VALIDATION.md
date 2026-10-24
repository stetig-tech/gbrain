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

Embedding model choice, 2026-10-24 (directional, n=30):

- Corpus: the 92 knowledge pages of the preview brain (232 live chunks; smoke
  pages excluded), embedded as GBrain does for `contextual_retrieval_mode=title`
  (its own title wrapper). Vectors were kept in a local scratch cache only.
- Queries: 30, with relevant pages fixed before any ranking: 17 Russian (mostly
  against English pages), 13 English, 4 containing identifiers. Page-level
  cosine ranking, all models at 1536 dimensions, all through AI Gateway.

| Model | Hit@5 | MRR@10 | Query embed p50 / p90 |
|---|---|---|---|
| `openai/text-embedding-3-small` | 29/30 | 0.771 | 449 / 610 ms |
| `google/gemini-embedding-001` | 29/30 | 0.903 | 958 / 1050 ms |
| `google/gemini-embedding-001`, Vertex task types | 29/30 | 0.892 | 1001 / 1144 ms |
| `google/gemini-embedding-2` | 27/30 | 0.904 | 360 / 413 ms |

- Rule: at most one extra top-5 miss and MRR within ~5 points of the OpenAI
  baseline counts as a tie; on a tie Gemini is preferred. Gemini-001 met it
  (same hits, higher MRR); Gemini-2 did not (two extra misses); task types
  gave no gain and would need code. Chosen: `litellm:google/gemini-embedding-001`
  at 1536 through `https://ai-gateway.vercel.sh/v1`, no task type.
- Gemini-001's only miss is a bare identifier (`DE/RA/…`, rank 18); the
  configured keyword search returns that page first.
- Cost: Gateway metadata reported $0.0034 for the OpenAI corpus (171k tokens)
  and $0 for Gemini (205k tokens). The Gemini figure is not taken as free:
  at the catalog price ($0.15 per 1M input tokens) it is an estimated $0.03.
- Preview brain before migration: config `voyage:voyage-4`, 1024d columns, no
  stored vectors; `migrate embeddings --to litellm:google/gemini-embedding-001
  --dim 1536 --dry-run` in the Sandbox plans 263 chunks, estimate $0.02,
  worst case $0.07.

Embeddings on preview, release `b60f540cf`:

- AI Gateway auth is the deployment's OIDC token, no stored key: 200 at 1536d
  from the laptop (`@vercel/oidc`, linked project) and from a Sandbox run given
  the token in its process env. Neither Vercel environment holds a Gateway key.
- Apply: `migrate embeddings --to litellm:google/gemini-embedding-001 --dim 1536
  --yes --max-cost-usd 0.10` (0 vectors stored before it). 263/263 chunks
  embedded at 1536d, all four vector columns rebuilt, smoke self-retrieval pass,
  $0.031 debited against the cap (gbrain's estimate). `--status`: 0 missing.
- Vectors are not unit length (norm 0.69–0.70, Gemini below 3072d); the HNSW
  index is `vector_cosine_ops`, so ranking is scale-free.
- The Function configures the gateway at boot and reads the bearer per call: a
  Russian query with no keyword overlap (before the backfill: 0 results) now
  returns the English trucking pages as `weak_semantic` hits through MCP `query`.
- A new `put_page` after the migration was published by the drain with its chunk
  unembedded; `embed --stale --max-usd 0.01` in the Sandbox completed it.

Not yet validated:

- Automatic stale-embedding completion: the drain publishes writes but does not
  embed them; until a capped `embed --stale` runs on a schedule, new pages are
  keyword-only.
- Gateway billing reconciliation against the dashboard.
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
