import type { ApiPort, RunStatus } from '../ports.js';

/**
 * The wait loop (ring M2, §5.4) — polls `ApiPort.listRuns` until `runId`
 * reaches a terminal status or the budget is spent. Pure application logic:
 * no `fetch`, no SDK, no clock of its own — `sleep`, `now`, `budgetMs` and
 * the `ApiPort` all arrive through `RunWaiterDeps` (REQ-32), which is what
 * lets `run-agent-on-pr.test.ts` prove REQ-13 with an injected clock instead
 * of a real timer.
 *
 * This is deliberately NOT the SSE run-events route — §5.4's table rejected
 * that: `RunBus` is a process-lifetime in-memory singleton, and an API
 * restart between `POST …/review` and the subscribe leaves it hanging.
 */

export interface RunWaiterDeps {
  api: ApiPort;
  /** REQ-13's overall wait budget, in ms (env-configured — never a tool argument). */
  budgetMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export type WaitOutcome =
  | { outcome: 'done'; runStatus: RunStatus }
  | { outcome: 'failed'; runStatus: RunStatus }
  | { outcome: 'cancelled'; runStatus: RunStatus }
  | { outcome: 'timeout' };

/** §5.4's cadence: first poll at 1.5s, then every 3s. */
const FIRST_POLL_DELAY_MS = 1_500;
const POLL_INTERVAL_MS = 3_000;

const TERMINAL_STATUSES = new Set<RunStatus['status']>(['done', 'failed', 'cancelled']);

type PollRace = { kind: 'rows'; rows: RunStatus[] } | { kind: 'deadline' };

/**
 * Races one `listRuns` call against the REMAINING budget (via `deps.sleep`),
 * not just against the interval between polls — this is what stops a poll
 * that never resolves from hanging the whole function past
 * `budget + one poll interval` (REQ-13's "deadline discipline", §5.4).
 */
async function pollOnce(pullId: string, remainingMs: number, deps: RunWaiterDeps): Promise<PollRace> {
  return Promise.race<PollRace>([
    deps.api.listRuns(pullId).then((rows): PollRace => ({ kind: 'rows', rows })),
    deps.sleep(remainingMs).then((): PollRace => ({ kind: 'deadline' })),
  ]);
}

export async function waitForRun(pullId: string, runId: string, deps: RunWaiterDeps): Promise<WaitOutcome> {
  const deadlineAt = deps.now() + deps.budgetMs;
  let delayMs = FIRST_POLL_DELAY_MS;

  while (deps.now() < deadlineAt) {
    await deps.sleep(delayMs);
    delayMs = POLL_INTERVAL_MS;

    const remainingMs = deadlineAt - deps.now();
    if (remainingMs <= 0) break;

    const raced = await pollOnce(pullId, remainingMs, deps);
    if (raced.kind === 'deadline') break;

    const match = raced.rows.find((row) => row.run_id === runId);
    if (match && TERMINAL_STATUSES.has(match.status)) {
      return { outcome: match.status as 'done' | 'failed' | 'cancelled', runStatus: match };
    }
    // status is still 'running', or this run_id has not shown up in the
    // history yet (a fresh `startReview` racing the very first poll) —
    // either way, loop again rather than treating it as terminal.
  }

  return { outcome: 'timeout' };
}
