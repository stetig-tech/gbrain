import type { BrainEngine } from '../core/engine.ts';

/** Durable backlog, including crash recovery. Blocked work stays visible for later attempts. */
export async function hasPendingPublication(engine: BrainEngine): Promise<boolean> {
  const [row] = await engine.executeRaw<{ pending: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM persistence_requests WHERE state IN ('queued','running','recovering') OR recovery IS NOT NULL)
    OR EXISTS (SELECT 1 FROM persistence_effects WHERE state IN ('queued','running') OR recovery IS NOT NULL)
    AS pending`);
  return row?.pending === true;
}

export interface GitHold { source_id: string; failed: number; retrying: number }

/**
 * Git effects that did not land: parked/failed ones run again only after `gbrain sources writer retry-effects`,
 * so an empty backlog alone does not mean every write reached the remote.
 */
export async function gitPublicationHolds(engine: BrainEngine): Promise<GitHold[]> {
  return engine.executeRaw<GitHold>(`SELECT source_id,
      count(*) FILTER (WHERE state='failed')::int AS failed,
      count(*) FILTER (WHERE state IN ('queued','running') AND error_code IS NOT NULL)::int AS retrying
    FROM persistence_effects WHERE kind='git' AND recovery IS NULL
      AND (state='failed' OR (state IN ('queued','running') AND error_code IS NOT NULL))
    GROUP BY source_id ORDER BY source_id`);
}
