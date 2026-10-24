import type { BrainEngine } from '../core/engine.ts';

/** Durable backlog, including crash recovery. Blocked work stays visible for later attempts. */
export async function hasPendingPublication(engine: BrainEngine): Promise<boolean> {
  const [row] = await engine.executeRaw<{ pending: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM persistence_requests WHERE state IN ('queued','running','recovering') OR recovery IS NOT NULL)
    OR EXISTS (SELECT 1 FROM persistence_effects WHERE state IN ('queued','running') OR recovery IS NOT NULL)
    AS pending`);
  return row?.pending === true;
}
