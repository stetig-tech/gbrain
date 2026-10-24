import type { BrainEngine } from '../engine.ts';
import type { GBrainConfig } from '../config.ts';
import { LANE_BUSY, type PersistenceConsumerLike } from './consumer.ts';

/** An admission-only host. No election, timers, local identity or filesystem writes. */
export class ExternalPersistenceConsumer implements PersistenceConsumerLike {
  private stopping = false;
  constructor(readonly engine: BrainEngine, readonly config: GBrainConfig) {}
  start(): void {}
  async stop(): Promise<void> { this.stopping = true; }
  wake(): void {}
  async tick(): Promise<void> {}
  holds(_id: string): boolean { return false; }
  foregroundCompletions(_worktreeId: string): number { return 0; }
  async onLane<T>(_run: (transaction: <R>(fn: (tx: BrainEngine) => Promise<R>) => Promise<R>) => Promise<T>): Promise<T | typeof LANE_BUSY> { return LANE_BUSY; }
  restartRequired(): boolean { return false; }
  status() {
    return { mode: 'external', accepting: !this.stopping, active_preparations: 0, active_worktrees: 0, restart_required: false };
  }
}
