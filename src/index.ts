import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { buildServeHttpApp } from './commands/serve-http.ts';
import { useExternalPersistenceConsumer } from './core/persistence/service.ts';
import { deploymentEngine } from './deployment/engine.ts';
import { assertDeploymentEnvironment, publicUrl, requiredEnv } from './deployment/config.ts';
import { publicErrorHandler } from './deployment/error-log.ts';
import { hasPendingPublication } from './deployment/pending.ts';
import { runSandboxWorker } from './deployment/sandbox.ts';

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
  const { engine } = await deploymentEngine();
  useExternalPersistenceConsumer(engine);
  try {
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
app.get('/internal/drain', async (req, res) => {
  assertDeploymentEnvironment();
  const expected = Buffer.from(`Bearer ${requiredEnv('CRON_SECRET')}`);
  const actual = Buffer.from(req.get('authorization') ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  res.locals.stage = 'drain.pending';
  const { engine } = await deploymentEngine();
  let pending: boolean;
  try { pending = await hasPendingPublication(engine); } finally { await engine.disconnect(); }
  if (!pending) { res.json({ status: 'idle' }); return; }
  res.locals.stage = 'drain.worker';
  await runSandboxWorker();
  res.json({ status: 'completed' });
});
app.use(async (req, res, next) => {
  res.locals.stage = 'api.initialize';
  ready ??= initialize().catch(error => { ready = undefined; throw error; });
  (await ready)(req, res, next);
});
app.use(publicErrorHandler());
export default app;
