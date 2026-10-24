/** Run explicitly in the publisher Sandbox against the direct Neon endpoint. */
import { createEngine } from '../src/core/engine-factory.ts';
import { loadConfig } from '../src/core/config.ts';
import { requiredEnv } from '../src/deployment/config.ts';
requiredEnv('GBRAIN_DATABASE_URL');
const config = loadConfig();
if (!config || config.engine !== 'postgres') throw new Error('Postgres configuration required');
const engine = await createEngine(config);
await engine.connect(config);
try { await engine.initSchema(); } finally { await engine.disconnect(); }
