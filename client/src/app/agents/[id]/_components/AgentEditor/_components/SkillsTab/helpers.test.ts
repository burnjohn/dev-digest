import { describe, it, expect } from "vitest";
import { filterByName, move, orderForDisplay, reconcileOrder, sameIds } from "./helpers";

describe("move — the primitive behind the reorder buttons", () => {
  it("moves an item up", () => {
    expect(move(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
  });

  it("moves an item down", () => {
    expect(move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("moves across the whole list", () => {
    expect(move(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    move(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns the list unchanged when from === to", () => {
    const input = ["a", "b"];
    expect(move(input, 1, 1)).toBe(input);
  });

  it("clamps out-of-range targets instead of creating holes", () => {
    // This is what lets the ▲ at index 0 and ▼ at the end be wired without guards.
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 2)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    expect(move([], 0, 0)).toEqual([]);
  });
});

describe("orderForDisplay", () => {
  const skills = [
    { id: "3", name: "charlie" },
    { id: "1", name: "alpha" },
    { id: "2", name: "bravo" },
    { id: "4", name: "delta" },
  ];

  it("puts linked skills first, in LINK order (not alphabetical)", () => {
    expect(orderForDisplay(skills, ["3", "1"]).map((s) => s.id)).toEqual(["3", "1", "2", "4"]);
  });

  it("sorts the unlinked remainder alphabetically", () => {
    expect(orderForDisplay(skills, []).map((s) => s.name)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
  });

  it("ignores linked ids that no longer exist", () => {
    expect(orderForDisplay(skills, ["ghost", "2"]).map((s) => s.id)).toEqual(["2", "1", "3", "4"]);
  });
});

describe("reconcileOrder", () => {
  it("keeps the remembered positions", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("drops ids that no longer exist", () => {
    expect(reconcileOrder(["c", "gone", "a"], ["a", "c"])).toEqual(["c", "a"]);
  });

  it("appends ids the remembered order has never seen, in current order", () => {
    expect(reconcileOrder(["b"], ["a", "b", "new"])).toEqual(["b", "a", "new"]);
  });
});

describe("sameIds — tells a row-only move from a prompt-order change", () => {
  it("is true for the same ids in the same order", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false when the order differs", () => {
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("is false when the length differs", () => {
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
  });

  it("is true for two empty lists", () => {
    expect(sameIds([], [])).toBe(true);
  });
});

describe("filterByName", () => {
  const items = [
    { name: "no-then-chains", description: "Use async/await" },
    { name: "secret-leakage-gate", description: "Detects sk_live keys" },
  ];

  it("returns everything for a blank query", () => {
    expect(filterByName(items, "   ")).toHaveLength(2);
  });

  it("matches the name case-insensitively", () => {
    expect(filterByName(items, "SECRET")).toHaveLength(1);
  });

  it("matches the description too", () => {
    expect(filterByName(items, "async")[0]?.name).toBe("no-then-chains");
  });

  it("returns [] when nothing matches", () => {
    expect(filterByName(items, "zzz")).toEqual([]);
  });
});
