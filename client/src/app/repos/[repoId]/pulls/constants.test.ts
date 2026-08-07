/**
 * GRID and COLUMN_KEYS are separate declarations that must describe the same
 * table. Adding a column while forgetting the other silently misaligns every
 * row against its header — cheap to pin, annoying to debug.
 * (PRRow's cells are the third leg; that one is pinned in PRRow.test.tsx.)
 */
import { describe, it, expect } from "vitest";
import { GRID, COLUMN_KEYS } from "./constants";

describe("PR list column declarations", () => {
  it("declares one grid track per column key", () => {
    expect(GRID.split(" ")).toHaveLength(COLUMN_KEYS.length);
  });
});
