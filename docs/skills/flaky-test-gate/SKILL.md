---
name: flaky-test-gate
description: Use when a diff adds or changes a test, to check it will give the same answer on the hundredth run as on the first.
type: convention
---

# Flaky tests

A test that fails once a fortnight is worse than no test: the team learns to
re-run it, and then learns to re-run the one that caught a real bug.

Flag as CRITICAL a test whose result depends on something the test does not
control:

- **Real time** — `Date.now()`, `new Date()`, or a sleep used to wait for work.
  Time must be injected or faked, and waiting must be on a condition, not a
  duration.
- **Real network, real clock-dependent I/O, or a live external service** in a
  suite that is meant to be hermetic.
- **Shared mutable state across tests** — a module-level counter, a cached
  singleton, a fixture written by one test and read by another. Order-dependent
  tests pass locally and fail under a different shard.
- **Unawaited async work** — an assertion that races the promise it is about, or
  a test that returns before its effects have settled.

Flag as WARNING a test that is deterministic today but fragile: an assertion on
iteration order that the source does not guarantee, a timeout tight enough that a
loaded CI machine trips it, a random or auto-generated value used in an equality
assertion.

For each finding, name the source of nondeterminism and the fix — inject the
clock, await the settle, reset the state in a hook. "This looks flaky" without a
mechanism is not a finding.
