/**
 * Protects serverless admission from running publisher election or touching the filesystem.
 * Regression: external mode falls through to the resident consumer or takes its lane.
 * Existing election tests permit promotion; this deployment must never promote. No test-only seam.
 */
import { expect, test, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import { LANE_BUSY } from '../src/core/persistence/consumer.ts';
import * as service from '../src/core/persistence/service.ts';

let publicationEngine: PGLiteEngine;
beforeAll(async () => { publicationEngine = new PGLiteEngine(); await publicationEngine.connect({}); await publicationEngine.initSchema(); }, 60_000);
afterAll(async () => { await publicationEngine.disconnect(); });

test('external admission never elects, claims or occupies a local transaction lane', async () => {
  let queries = 0;
  const engine = { kind: 'postgres', executeRaw: async () => { queries++; throw new Error('Unexpected publisher query'); } } as unknown as BrainEngine;
  service.useExternalPersistenceConsumer(engine);
  const consumer = service.startPersistenceConsumer(engine, { engine: 'postgres' });
  consumer.start(); consumer.wake(true); await consumer.tick();
  expect(await consumer.onLane(async () => { throw new Error('Must not run on a publisher lane'); })).toBe(LANE_BUSY);
  expect(consumer.status().mode).toBe('external');
  expect(service.startPersistenceConsumer(engine, { engine: 'postgres' })).toBe(consumer);
  await service.stopPersistenceConsumer(engine);
  expect(() => service.startPersistenceConsumer(engine, { engine: 'postgres' })).toThrow('closing');
  expect(queries).toBe(0);
});

test('an accepted write remains queued until the separate publisher writes its canonical file', async () => {
  const { submitPageMutation } = await import('../src/core/persistence/page-mutations.ts');
  const { claimWorktree } = await import('../src/core/persistence/ownership.ts');
  const { activatePersistence } = await import('../src/core/persistence/activation.ts');
  const { PersistenceConsumer } = await import('../src/core/persistence/consumer.ts');
  const { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const { withEnv } = await import('./helpers/with-env.ts');
  const { waitFor } = await import('./helpers/wait-for.ts');
  const home = mkdtempSync(join(tmpdir(), 'gbrain-vercel-publication-'));
  const root = join(home, 'brain'); mkdirSync(root);
  try { await withEnv({ GBRAIN_HOME: home, DATABASE_URL: undefined, GBRAIN_DATABASE_URL: undefined }, async () => {
    const engine = publicationEngine;
    let publisher: InstanceType<typeof PersistenceConsumer> | undefined;
    try {
      await engine.executeRaw('INSERT INTO sources(id,name,local_path) VALUES($1,$1,$2)', ['fixture', root]);
      await claimWorktree(engine, 'fixture', root);
      await activatePersistence(engine, { confirmQuiesced: true });
      service.useExternalPersistenceConsumer(engine);
      const request_id = randomUUID();
      await withEnv({ GBRAIN_HOME: join(home, 'api') }, async () => {
      await expect(submitPageMutation({ engine, config: { engine: 'pglite' }, sourceId: 'fixture', remote: true, dryRun: false,
        logger: { info() {}, warn() {}, error() {} } }, { operation: 'put_page', params: {
          slug: 'example', content: '---\ntitle: Example\ntype: note\n---\nDurable deployment fixture.', request_id, wait_ms: 0,
        } })).rejects.toMatchObject({ code: 'write_pending' });
      });
      expect(existsSync(join(root, 'example.md'))).toBe(false);
      const state = async () => (await engine.executeRaw<{ state: string }>('SELECT state FROM persistence_requests WHERE request_id=$1::uuid', [request_id]))[0]?.state;
      expect(await state()).toBe('queued');
      publisher = new PersistenceConsumer(engine, { engine: 'pglite' }, service.preparePersistedMutation);
      publisher.start();
      await waitFor(async () => await state() === 'committed');
      expect(readFileSync(join(root, 'example.md'), 'utf8')).toContain('Durable deployment fixture.');
    } finally { await publisher?.stop(); await service.disposePersistenceConsumer(engine); }
  }); } finally { rmSync(home, { recursive: true, force: true }); }
}, 60_000);
