/**
 * RunBus lifecycle:
 *  - one bus PER Container (no process-wide singleton shared across app
 *    instances / tests);
 *  - per-run state (buffer, seq, completed, cancelled) is evicted a grace
 *    period after complete(), so a long-lived process does not accumulate the
 *    full event log of every run ever executed. Replay-first semantics for
 *    late subscribers keep working inside the grace window, and cancel-state
 *    stays terminal until eviction (see sse-cancel.test.ts).
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

  it('evicts buffer, seq, and completion state after the grace period', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'line 1');
    bus.publish('r1', 'info', 'line 2');
    bus.complete('r1');

    vi.advanceTimersByTime(GRACE_MS + 1);

    expect(bus.buffer('r1')).toHaveLength(0);
    expect(bus.isComplete('r1')).toBe(false);
    const seen: RunEvent[] = [];
    bus.subscribe('r1', (e) => seen.push(e));
    expect(seen).toHaveLength(0);
    // seq restarts too — the run's numbering is gone with the state.
    const next = bus.publish('r1', 'info', 'fresh');
    expect(next.seq).toBe(1);
  });

  it('cancel-state survives until eviction, then is released', () => {
    const bus = new RunBus();
    bus.cancel('r1');
    bus.complete('r1'); // exactly what ReviewService.cancelRun does
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(bus.isCancelled('r1')).toBe(true);
    vi.advanceTimersByTime(2);
    expect(bus.isCancelled('r1')).toBe(false);
  });

  it('an uncompleted run is never evicted', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'still running');
    vi.advanceTimersByTime(GRACE_MS * 10);
    expect(bus.buffer('r1')).toHaveLength(1);
  });

  it('a second complete() reschedules rather than double-frees', () => {
    const bus = new RunBus();
    bus.cancel('r1');
    bus.complete('r1'); // route-side cancelRun
    vi.advanceTimersByTime(GRACE_MS / 2);
    bus.complete('r1'); // executor notices the cancel and completes again
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(bus.isCancelled('r1')).toBe(true); // grace restarted at 2nd complete
    vi.advanceTimersByTime(2);
    expect(bus.isCancelled('r1')).toBe(false);
  });
});
