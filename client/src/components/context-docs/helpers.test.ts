import { describe, it, expect } from "vitest";
import {
  filterByPath,
  move,
  orderForDisplay,
  reconcileOrder,
  samePaths,
  shiftPath,
  splitDocPath,
} from "./helpers";

describe("move — the primitive behind both the drag drop and the keyboard shift", () => {
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
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 2)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("shiftPath — the keyboard-operable reorder (REQ-36)", () => {
  it("moves the path up one slot", () => {
    expect(shiftPath(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("moves the path down one slot", () => {
    expect(shiftPath(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at the top boundary", () => {
    const input = ["a", "b", "c"];
    expect(shiftPath(input, "a", -1)).toBe(input);
  });

  it("is a no-op at the bottom boundary", () => {
    const input = ["a", "b", "c"];
    expect(shiftPath(input, "c", 1)).toBe(input);
  });

  it("is a no-op for a path that is not in the list", () => {
    const input = ["a", "b", "c"];
    expect(shiftPath(input, "ghost", -1)).toBe(input);
  });

  it("produces the SAME ordering as an equivalent sequence of pointer drops", () => {
    // Drag "d" onto "a"'s row — a single `move` from index 3 to index 0.
    const start = ["a", "b", "c", "d"];
    const viaDrag = move(start, start.indexOf("d"), start.indexOf("a"));

    // The keyboard path steps one row at a time; three ArrowUp presses on
    // "d" cover the same net movement.
    let viaKeyboard = start;
    viaKeyboard = shiftPath(viaKeyboard, "d", -1);
    viaKeyboard = shiftPath(viaKeyboard, "d", -1);
    viaKeyboard = shiftPath(viaKeyboard, "d", -1);

    expect(viaKeyboard).toEqual(viaDrag);
    expect(viaKeyboard).toEqual(["d", "a", "b", "c"]);
  });

  it("agrees with a pointer drop for a downward move too", () => {
    const start = ["a", "b", "c", "d"];
    const viaDrag = move(start, start.indexOf("a"), start.indexOf("d"));

    let viaKeyboard = start;
    viaKeyboard = shiftPath(viaKeyboard, "a", 1);
    viaKeyboard = shiftPath(viaKeyboard, "a", 1);
    viaKeyboard = shiftPath(viaKeyboard, "a", 1);

    expect(viaKeyboard).toEqual(viaDrag);
  });
});

describe("orderForDisplay", () => {
  it("lists attached documents first, in STORED order, then the rest by path", () => {
    const all = [{ path: "docs/zeta.md" }, { path: "docs/alpha.md" }, { path: "docs/beta.md" }];
    // Stored (server) order is beta, zeta — neither alphabetical nor insertion order.
    const ordered = orderForDisplay(all, ["docs/beta.md", "docs/zeta.md"]);
    expect(ordered.map((d) => d.path)).toEqual(["docs/beta.md", "docs/zeta.md", "docs/alpha.md"]);
  });

  it("drops attached paths for documents that no longer exist", () => {
    const all = [{ path: "docs/alpha.md" }];
    const ordered = orderForDisplay(all, ["docs/deleted.md", "docs/alpha.md"]);
    expect(ordered.map((d) => d.path)).toEqual(["docs/alpha.md"]);
  });
});

describe("filterByPath", () => {
  const docs = [
    { path: "specs/security-baseline.md" },
    { path: "docs/architecture.md" },
    { path: "insights/incident-2026-04-checkout.md" },
  ];

  it("returns everything for a blank query", () => {
    expect(filterByPath(docs, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively anywhere in the path", () => {
    expect(filterByPath(docs, "SECURITY")).toHaveLength(1);
    expect(filterByPath(docs, "2026")).toHaveLength(1);
  });

  it("returns [] when nothing matches", () => {
    expect(filterByPath(docs, "zzz")).toEqual([]);
  });
});

describe("reconcileOrder", () => {
  it("keeps the remembered positions", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("drops paths that no longer exist", () => {
    expect(reconcileOrder(["c", "gone", "a"], ["a", "c"])).toEqual(["c", "a"]);
  });

  it("appends paths the remembered order has never seen, in current order", () => {
    expect(reconcileOrder(["b"], ["a", "b", "new.md"])).toEqual(["b", "a", "new.md"]);
  });
});

describe("samePaths", () => {
  it("is true for the same paths in the same order", () => {
    expect(samePaths(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false when the order differs", () => {
    expect(samePaths(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("is false when the length differs", () => {
    expect(samePaths(["a"], ["a", "b"])).toBe(false);
  });
});

describe("splitDocPath", () => {
  it("splits a nested path into its dimmed dir and its filename", () => {
    expect(splitDocPath("specs/security-baseline.md")).toEqual({
      dir: "specs/",
      filename: "security-baseline.md",
    });
  });

  it("splits a deeply nested path on the LAST separator only", () => {
    expect(splitDocPath("docs/api/public-api.md")).toEqual({
      dir: "docs/api/",
      filename: "public-api.md",
    });
  });

  it("returns an empty dir for a root-level document", () => {
    expect(splitDocPath("readme.md")).toEqual({ dir: "", filename: "readme.md" });
  });
});
