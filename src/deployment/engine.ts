import { createEngine } from '../core/engine-factory.ts';
import { loadConfig, loadConfigWithEngine } from '../core/config.ts';
import { requiredEnv } from './config.ts';

/** Schema migrations are an explicit operator step, never a cold-start side effect. */
export async function deploymentEngine() {
  requiredEnv('GBRAIN_DATABASE_URL');
  const config = loadConfig();
  if (!config || config.engine !== 'postgres') throw new Error('Deployment requires Postgres');
  const engine = await createEngine(config);
  const connectionConfig = { ...config, poolSize: Number(process.env.GBRAIN_POOL_SIZE ?? 2) };
  if (!Number.isInteger(connectionConfig.poolSize) || connectionConfig.poolSize < 1 || connectionConfig.poolSize > 10) throw new Error('GBRAIN_POOL_SIZE must be 1..10');
  await engine.connect(connectionConfig);
  try {
    const [brain] = await engine.executeRaw<{ enabled: boolean }>('SELECT enabled FROM persistence_brain WHERE singleton=1');
    if (!brain?.enabled) throw new Error('Activate managed persistence in the Sandbox before serving MCP');
    return { engine, config: await loadConfigWithEngine(engine, config) ?? config };
  } catch (error) {
    await engine.disconnect();
    throw error;
  }
}
