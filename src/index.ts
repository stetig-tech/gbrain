import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { buildServeHttpApp } from './commands/serve-http.ts';
import { useExternalPersistenceConsumer } from './core/persistence/service.ts';
import { deploymentEngine } from './deployment/engine.ts';
import { assertDeploymentEnvironment, publicUrl, requiredEnv } from './deployment/config.ts';
import { publicErrorHandler } from './deployment/error-log.ts';
import { gitPublicationHolds, hasPendingPublication } from './deployment/pending.ts';
import { runSandboxWorker } from './deployment/sandbox.ts';
import { gatewayBearer } from './deployment/ai-gateway.ts';
import { buildGatewayConfig } from './core/ai/build-gateway-config.ts';
import { configureGateway, reconfigureGatewayWithEngine } from './core/ai/gateway.ts';
import { setRequestBearer } from './core/ai/request-bearer.ts';

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
let ready: Promise<express.Express> | undefined;
async function initialize() {
  assertDeploymentEnvironment();
  process.env.GBRAIN_HOME = '/tmp/gbrain-api';
  process.env.GBRAIN_POOL_SIZE ??= '2';
  process.env.GBRAIN_PREPARE ??= 'false';
  const origin = publicUrl();
  const { engine, config } = await deploymentEngine();
  useExternalPersistenceConsumer(engine);
  try {
    // A warm Function outlives an OIDC token, so the Gateway bearer is resolved per call, in that request's context.
    setRequestBearer({ recipeId: 'litellm', token: gatewayBearer });
    configureGateway(buildGatewayConfig(config));
    await reconfigureGatewayWithEngine(engine);
    const api = express();
    await buildServeHttpApp(api, engine, {
      port: 3000, tokenTtl: 3600, enableDcr: false, publicUrl: origin,
      suppressBootstrapToken: true, serverless: true, surface: 'starter',
    });
    api.get('/health', async (_req, res) => {
      await engine.executeRaw('SELECT 1');
      res.json({ status: 'ok', persistence: 'external' });
    });
    return api;
  } catch (error) { await engine.disconnect(); throw error; }
}
async function publicationState() {
  const { engine } = await deploymentEngine();
  try { return { pending: await hasPendingPublication(engine), holds: await gitPublicationHolds(engine) }; } finally { await engine.disconnect(); }
}
/** Held Git publication outranks an empty or drained backlog: those writes have not reached the remote. */
function reportDrain(res: express.Response, { pending, holds }: Awaited<ReturnType<typeof publicationState>>, ran: boolean) {
  const git_held = holds.reduce((sum, hold) => sum + hold.failed, 0);
  if (holds.length) console.warn(JSON.stringify({ event: 'gbrain_git_held', holds: holds.map(hold => ({
    ...hold, fix: { argv: ['gbrain', 'sources', 'writer', 'retry-effects', hold.source_id, '--parked-pushes', '--dry-run'] },
  })) }));
  if (pending && ran) { res.status(202).json({ status: 'backlog_remaining', git_held }); return; }
  if (git_held) { res.json({ status: 'git_held', git_held }); return; }
  res.json({ status: ran ? 'completed' : 'idle', git_held });
}
app.get('/internal/drain', async (req, res) => {
  assertDeploymentEnvironment();
  const expected = Buffer.from(`Bearer ${requiredEnv('CRON_SECRET')}`);
  const actual = Buffer.from(req.get('authorization') ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  res.locals.stage = 'drain.pending';
  const before = await publicationState();
  if (!before.pending) { reportDrain(res, before, false); return; }
  res.locals.stage = 'drain.worker';
  await runSandboxWorker();
  res.locals.stage = 'drain.recheck';
  // The worker exits cleanly on its deadline or on SIGTERM with work left; that is not a completed drain.
  reportDrain(res, await publicationState(), true);
});
app.use(async (req, res, next) => {
  res.locals.stage = 'api.initialize';
  ready ??= initialize().catch(error => { ready = undefined; throw error; });
  (await ready)(req, res, next);
});
app.use(publicErrorHandler());
export default app;
