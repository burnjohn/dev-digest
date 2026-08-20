/**
 * RunBus lifecycle:
 *  - one bus PER Container (no process-wide singleton shared across app
 *    instances / tests);
 *  - a run's HEAVY state (event buffer, seq, emitters, abort controller) is
 *    evicted a grace period after complete(), so a long-lived process does not
 *    accumulate the full event log of every run ever executed. Replay-first
 *    semantics for late subscribers keep working inside the grace window.
 *  - the TERMINAL flags (completed, cancelled) are NEVER evicted: agents for
 *    one PR run sequentially, so a cancelled run may sit queued far longer
 *    than the grace window — releasing `cancelled` would let it run (and
 *    bill) anyway; releasing `completed` would make a late SSE subscriber
 *    hang forever waiting for a 'done' that already happened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunBus } from '../src/platform/sse.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { RunEvent } from '@devdigest/shared';

const GRACE_MS = 5 * 60_000;

describe('RunBus — one instance per Container', () => {
  it('two containers do not share a bus', () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const fakeDb = {} as Db;
    const a = new Container(config, fakeDb);
    const b = new Container(config, fakeDb);
    expect(a.runBus).toBeInstanceOf(RunBus);
    expect(b.runBus).toBeInstanceOf(RunBus);
    expect(a.runBus).not.toBe(b.runBus);
    // State published on one container's bus must not leak into the other.
    a.runBus.cancel('r1');
    expect(b.runBus.isCancelled('r1')).toBe(false);
  });
});

describe('RunBus — post-complete eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps replay + completion state inside the grace window', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.complete('r1');

    vi.advanceTimersByTime(GRACE_MS - 1);

    // Late subscriber still replays the full buffer (the client relies on it).
    const seen: RunEvent[] = [];
    bus.subscribe('r1', (e) => seen.push(e));
    expect(seen.map((e) => e.msg)).toEqual(['line 1']);
    expect(bus.isComplete('r1')).toBe(true);
    expect(bus.buffer('r1')).toHaveLength(1);
  });

  it('evicts buffer and seq after the grace period', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.publish('r1', 'info', 'line 2');
    bus.complete('r1');

    vi.advanceTimersByTime(GRACE_MS + 1);

    expect(bus.buffer('r1')).toHaveLength(0);
    const seen: RunEvent[] = [];
    bus.subscribe('r1', (e) => seen.push(e));
    expect(seen).toHaveLength(0);
  });

  it('completion stays visible after eviction — a late SSE subscriber must end, not hang', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.complete('r1');

    vi.advanceTimersByTime(GRACE_MS + 1);

    // The SSE route's replay-then-end contract: isComplete/onDone must still
    // report the run as done, or the stream awaits a 'done' that never fires.
    expect(bus.isComplete('r1')).toBe(true);
    let done = false;
    bus.onDone('r1', () => (done = true));
    return vi.waitFor(() => expect(done).toBe(true));
  });

  it('cancellation is terminal — it survives eviction', () => {
    const bus = new RunBus();
    bus.cancel('r4');
    bus.complete('r4'); // exactly what ReviewService.cancelRun does

    // Agents run sequentially: run #4 of a fan-out may reach the executor's
    // isCancelled() checkpoint LONG after the grace window. If eviction
    // released the flag, the cancelled run would execute and bill anyway.
    vi.advanceTimersByTime(GRACE_MS * 10);
    expect(bus.isCancelled('r4')).toBe(true);
    // And the LLM abort signal handed out later must already be aborted.
    expect(bus.signalFor('r4').aborted).toBe(true);
  });

  it('an uncompleted run is never evicted', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'still running');
    vi.advanceTimersByTime(GRACE_MS * 10);
    expect(bus.buffer('r1')).toHaveLength(1);
  });

  it('a second complete() reschedules rather than double-frees', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.complete('r1'); // route-side cancelRun
    vi.advanceTimersByTime(GRACE_MS / 2);
    bus.complete('r1'); // executor notices the cancel and completes again
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(bus.buffer('r1')).toHaveLength(1); // grace restarted at 2nd complete
    vi.advanceTimersByTime(2);
    expect(bus.buffer('r1')).toHaveLength(0);
  });

  it('subscribing to an evicted run does not resurrect per-run state', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.complete('r1');
    vi.advanceTimersByTime(GRACE_MS + 1);

    // A completed run with no live emitter gets replay (empty) + immediate
    // done, and must NOT re-create buffer/seq entries that nothing will ever
    // evict again (complete() will not be called a second time).
    const unsubscribe = bus.subscribe('r1', () => undefined);
    unsubscribe();
    expect(bus.buffer('r1')).toHaveLength(0);
    expect(bus.hasLiveState('r1')).toBe(false);
  });
});
