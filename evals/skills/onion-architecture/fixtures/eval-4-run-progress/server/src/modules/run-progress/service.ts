import type { Container } from '../../platform/container.js';
import { runBus } from '../../platform/infra/sse.js';
import { RunProgressRepository } from './repository.js';
import { PROGRESS_CHECKPOINT_INTERVAL } from './constants.js';

/**
 * Run-progress service. Tracks per-step checkpoints for a long-running review
 * or index run and streams a lightweight progress event after every N steps,
 * independent of the full RunEvent log the reviewer-core map-reduce writes.
 */
export class RunProgressService {
  private repo: RunProgressRepository;

  constructor(private container: Container) {
    this.repo = new RunProgressRepository(container.db);
  }

  async advance(runId: string, step: number, total: number): Promise<void> {
    if (step % PROGRESS_CHECKPOINT_INTERVAL === 0 || step === total) {
      await this.repo.recordCheckpoint(runId, step, total);
      runBus.publish(runId, 'progress', `step ${step}/${total}`, { step, total });
    }
  }

  async status(runId: string) {
    return this.repo.latest(runId);
  }
}
