/**
 * RunBus cancellation. The flag used to be cleared inside `complete()`, and
 * `cancelRun` calls `cancel()` then `complete()` two lines apart — so it lived
 * for the length of one UPDATE and every later `isCancelled()` saw false. Three
 * cancelled runs finished anyway and were billed.
 */
import { describe, it, expect } from 'vitest';
import { RunBus } from '../src/platform/sse.js';

describe('RunBus — cancellation is terminal', () => {
  it('survives complete(), which is called right after cancel()', () => {
    const bus = new RunBus();
    bus.cancel('r1');
    bus.complete('r1'); // exactly what ReviewService.cancelRun does
    expect(bus.isCancelled('r1')).toBe(true);
  });

  it('does not leak across runs', () => {
    const bus = new RunBus();
    bus.cancel('r1');
    expect(bus.isCancelled('r2')).toBe(false);
  });
});

describe('RunBus — abort signal', () => {
  it('aborts a signal handed out before the cancel', () => {
    const bus = new RunBus();
    const signal = bus.signalFor('r1');
    expect(signal.aborted).toBe(false);
    bus.cancel('r1');
    expect(signal.aborted).toBe(true);
  });

  it('hands out an already-aborted signal when the run was cancelled first', () => {
    // The ordering that matters in production: the route cancels while an
    // earlier agent is still running, so this run asks for its signal later.
    const bus = new RunBus();
    bus.cancel('r1');
    expect(bus.signalFor('r1').aborted).toBe(true);
  });

  it('gives the same signal for repeated calls on one run', () => {
    const bus = new RunBus();
    expect(bus.signalFor('r1')).toBe(bus.signalFor('r1'));
  });
});
