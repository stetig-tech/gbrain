# Validation record

Prepared against upstream/fork commit `36121271caf3dea8ffc2240deb28c5da50f7eade`
with Bun 1.4.4.

- TypeScript typecheck: passed.
- Bun bundling of the Vercel entrypoint: passed (not a Vercel platform build).
- Targeted regression suite: **25 passed**, covering serverless bearer MCP,
  catalog/metadata, omitted resident routes, admission on a different host
  identity followed by canonical publication, resident route wiring and consumer
  election.
- HTTP regression discrimination: restoring the upstream resident-only builder
  makes the serverless test fail; the modified builder passes.
- Repository verify: 88/89 passed in the last full run. The remaining documentation
  size violation was corrected; its `check:doc-history` rerun passed. No skips in
  that full run. Typecheck was rerun after the final edits and passed.
- Existing `serve-http-auth-outcomes.test.ts`: 5 passed / 6 failed, with identical
  results on a clean worktree of the base commit. These failures involve client
  registration returning 503. Confidential OAuth registration needs a separate
  investigation/Neon smoke test; scoped bearer MCP is the tested initial path.
- The complete upstream unit/serial/E2E suite was not run.
- Docker is unavailable on the local host. Image build is configured in
  `.github/workflows/vercel-check.yml` but has not run here.
- No Vercel deployment, Neon database, Sandbox Drive or production token was
  created. Actual Vercel packaging, Neon behavior, Git push and Drive identity/
  crash recovery remain the deployment gates in README.md.
