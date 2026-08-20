import { EventEmitter } from 'node:events';
import type { RunEvent, RunEventKind } from '@devdigest/shared';

/**
 * SSE / run-log bus.
 *
 * During a run, events are pushed to an in-memory buffer and emitted live to
 * any SSE subscriber on `/runs/:id/events`. On completion the full log is
 * persisted as ONE document in `run_traces` (done by the service layer, not here).
 *
 * Event shape on the wire (SSE `data`): RunEvent (see @devdigest/shared).
 */

/** Wall-clock time-of-day (HH:MM:SS, local) stamped on each log line. */
function clockTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * How long a run's state (buffer/seq/completed/cancelled) survives after
 * complete(). Late subscribers replay the buffer inside this window (the
 * client relies on replay-first semantics); after it the run's in-memory
 * footprint is released — the persisted run_traces row is the durable record.
 */
const RUN_STATE_EVICT_MS = 5 * 60_000;

export class RunBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, RunEvent[]>();
  private seq = new Map<string, number>();
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private evictTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Signal handed to the LLM call so cancellation can tear the request down.
   * The checkpoint flag alone only stops the NEXT call; an in-flight generation
   * keeps running — and keeps billing — until it finishes on its own.
   */
  signalFor(runId: string): AbortSignal {
    let c = this.controllers.get(runId);
    if (!c) {
      c = new AbortController();
      this.controllers.set(runId, c);
      // Cancelled before the run reached the LLM: hand back an already-aborted
      // signal rather than a live one.
      if (this.cancelled.has(runId)) c.abort();
    }
    return c.signal;
  }

  /** Request cancellation of an in-flight run: abort the live request, and set
   *  the flag the runner checks at its next checkpoint. */
  cancel(runId: string): void {
    this.cancelled.add(runId);
    this.controllers.get(runId)?.abort();
  }

  /** Whether cancellation has been requested for a run. */
  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  private emitterFor(runId: string): EventEmitter {
    let e = this.emitters.get(runId);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(50);
      this.emitters.set(runId, e);
      // Preserve any existing buffer/seq (e.g. a late subscriber after the run
      // completed must still be able to replay the buffered events).
      if (!this.buffers.has(runId)) this.buffers.set(runId, []);
      if (!this.seq.has(runId)) this.seq.set(runId, 0);
    }
    return e;
  }

  /** Publish a live event for a run. Returns the constructed RunEvent. */
  publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): RunEvent {
    const e = this.emitterFor(runId);
    const next = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, next);
    const event: RunEvent = { runId, seq: next, kind, msg, t: clockTime(), data };
    this.buffers.get(runId)!.push(event);
    e.emit('event', event);
    return event;
  }

  /** Subscribe to live events. Replays any buffered events first. */
  subscribe(runId: string, listener: (e: RunEvent) => void): () => void {
    // A completed run with no live emitter emits nothing ever again: replay
    // whatever buffer survives and DON'T resurrect per-run state — complete()
    // will not run a second time, so anything created here would never evict.
    if (this.completed.has(runId) && !this.emitters.has(runId)) {
      for (const buffered of this.buffers.get(runId) ?? []) listener(buffered);
      return () => undefined;
    }
    const e = this.emitterFor(runId);
    for (const buffered of this.buffers.get(runId) ?? []) listener(buffered);
    e.on('event', listener);
    return () => e.off('event', listener);
  }

  /** The full buffered log for a run (used to persist the trace on completion). */
  buffer(runId: string): RunEvent[] {
    return this.buffers.get(runId) ?? [];
  }

  /** Signal completion and release buffers/emitters. */
  complete(runId: string): void {
    const e = this.emitters.get(runId);
    this.completed.add(runId);
    // Deliberately NOT clearing `cancelled`: cancellation is terminal. It used
    // to be cleared here, and since cancelRun() calls cancel() then complete()
    // two lines apart, the flag lived for the length of one UPDATE — every
    // later isCancelled() saw false, so nothing downstream could ever stop.
    e?.emit('done');
    // Keep the buffer briefly available for late subscribers; clear emitter.
    this.emitters.delete(runId);
    // Evict the run's remaining state after a grace window. complete() can run
    // more than once for one run (route-side cancelRun, then the executor's own
    // completion) — the latest call wins the timer. unref()'d so a pending
    // eviction never keeps the process alive.
    const pending = this.evictTimers.get(runId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => this.evict(runId), RUN_STATE_EVICT_MS);
    timer.unref?.();
    this.evictTimers.set(runId, timer);
  }

  /**
   * Drop a run's HEAVY state from memory (post-grace; see complete()).
   *
   * The terminal flags are deliberately KEPT:
   *  - `cancelled`: agents for one PR run sequentially, so a cancelled run can
   *    reach the executor's isCancelled() checkpoint long after the grace
   *    window — releasing the flag here would let it run (and bill) anyway,
   *    the exact bug the comment in complete() describes on a 5-minute delay.
   *  - `completed`: the SSE route ends a late subscriber's stream via
   *    isComplete()/onDone(); releasing it would make that stream hang forever.
   * Both are one uuid string per run in a local-first single-instance process —
   * the unbounded growth this eviction exists to stop is the event BUFFERS.
   */
  private evict(runId: string): void {
    this.evictTimers.delete(runId);
    this.emitters.delete(runId);
    this.buffers.delete(runId);
    this.seq.delete(runId);
    this.controllers.delete(runId);
  }

  /** Test seam: does any evictable (heavy) state exist for this run? */
  hasLiveState(runId: string): boolean {
    return (
      this.emitters.has(runId) ||
      this.buffers.has(runId) ||
      this.seq.has(runId) ||
      this.controllers.has(runId) ||
      this.evictTimers.has(runId)
    );
  }

  /** Whether a run has already completed (for replay-then-end late subscribers). */
  isComplete(runId: string): boolean {
    return this.completed.has(runId);
  }

  onDone(runId: string, listener: () => void): () => void {
    // A run that already completed fires immediately so late SSE subscribers,
    // after replaying the buffer, end the stream instead of hanging forever.
    if (this.completed.has(runId)) {
      queueMicrotask(listener);
      return () => undefined;
    }
    const e = this.emitterFor(runId);
    e.once('done', listener);
    return () => e.off('done', listener);
  }
}
