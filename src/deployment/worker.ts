import { hasPendingPublication } from './pending.ts';
import { existsSync } from 'node:fs';
import { deploymentEngine } from './engine.ts';
import { configureDeploymentGateway } from './ai-gateway.ts';
import { startPersistenceConsumer, stopPersistenceConsumer } from '../core/persistence/service.ts';

// Provisioning creates the checkout, owner identity and source bindings on this same Drive.
if (process.env.GBRAIN_HOME !== '/data' || !existsSync('/data/.gbrain/persistence/host.json')) {
  throw new Error('Sandbox Drive is not initialized; refusing to mint a new publisher identity');
}
const { engine, config } = await deploymentEngine();
try {
  await configureDeploymentGateway(engine, config);
  const consumer = startPersistenceConsumer(engine, config);
  // Stop on an empty durable backlog; a later admission is picked up by the next Cron.
  const deadline = Date.now() + 210_000;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    while (!stopping && Date.now() < deadline && !consumer.restartRequired()) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await hasPendingPublication(engine)) break;
    }
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  if (consumer.restartRequired()) throw new Error('Persistence consumer requires restart; inspect writer status');
} finally {
  await stopPersistenceConsumer(engine);
  await engine.disconnect();
}
