import { describe, expect, it } from "vitest";
import type { PrCommit } from "@devdigest/shared";
import { isIntentStale } from "./helpers";

const GENERATED = "2026-08-20T10:00:00.000Z";

function commit(sha: string, committed_at: string | null): PrCommit {
  return { sha, message: `msg ${sha}`, author: "octocat", committed_at };
}

describe("isIntentStale", () => {
  it("is stale when the head commit landed after the intent was generated", () => {
    // Mutation caught: flipping the comparison to `<` or dropping it entirely.
    const commits = [commit("head", "2026-08-20T11:00:00.000Z")];
    expect(isIntentStale(GENERATED, "head", commits)).toBe(true);
  });

  it("is NOT stale when the head commit predates the intent", () => {
    // Mutation caught: comparing the wrong pair, or always returning true.
    const commits = [commit("head", "2026-08-20T09:00:00.000Z")];
    expect(isIntentStale(GENERATED, "head", commits)).toBe(false);
  });

  it("is NOT stale when the head commit and the intent share a timestamp", () => {
    // Mutation caught: using `>=` instead of `>` — a re-classification stamps
    // `generated_at` from the server clock, so equality must not re-flag it.
    expect(isIntentStale(GENERATED, "head", [commit("head", GENERATED)])).toBe(false);
  });

  it("matches on head_sha, not on the newest commit in the list", () => {
    // Mutation caught: taking commits[0] / the max timestamp instead of the
    // commit whose sha IS the head. A PR can carry commits newer than its head
    // (e.g. after a force-push rewrote the branch).
    const commits = [
      commit("head", "2026-08-20T09:00:00.000Z"),
      commit("other", "2026-08-20T23:00:00.000Z"),
    ];
    expect(isIntentStale(GENERATED, "head", commits)).toBe(false);
  });

  it("fails closed when the head commit is not in the list", () => {
    // Mutation caught: `?.committed_at` losing its guard and throwing, or the
    // undefined falling through to Date.parse(undefined) → NaN → true.
    const commits = [commit("some-other-sha", "2026-08-20T23:00:00.000Z")];
    expect(isIntentStale(GENERATED, "head", commits)).toBe(false);
  });

  it("fails closed when the head commit has no committed_at", () => {
    // Mutation caught: dropping the null check — `committed_at` is nullish in
    // the contract (platform.ts:208).
    expect(isIntentStale(GENERATED, "head", [commit("head", null)])).toBe(false);
  });

  it("fails closed when generated_at is missing", () => {
    // Mutation caught: dropping the guard — `generated_at` is nullish on
    // PrIntentDetail, and legacy rows predate the field.
    const commits = [commit("head", "2026-08-20T11:00:00.000Z")];
    expect(isIntentStale(null, "head", commits)).toBe(false);
    expect(isIntentStale(undefined, "head", commits)).toBe(false);
  });

  it("fails closed when headSha is missing or the commit list is empty", () => {
    // Mutation caught: making the props required and crashing on a PR whose
    // detail degraded to `diff_source: 'unavailable'` (empty commits).
    expect(isIntentStale(GENERATED, null, [commit("head", "2026-08-20T11:00:00.000Z")])).toBe(false);
    expect(isIntentStale(GENERATED, "head", [])).toBe(false);
    expect(isIntentStale(GENERATED, "head", undefined)).toBe(false);
  });

  it("fails closed on an unparseable date rather than flagging stale", () => {
    // Mutation caught: dropping the Number.isNaN guards — NaN > NaN is false,
    // but NaN comparisons silently swallow real bugs, so pin the intent.
    expect(isIntentStale(GENERATED, "head", [commit("head", "not-a-date")])).toBe(false);
    expect(isIntentStale("not-a-date", "head", [commit("head", GENERATED)])).toBe(false);
  });
});
