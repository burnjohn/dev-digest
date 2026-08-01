/**
 * The PR list's columns are declared in three places that must stay in lockstep
 * — the CSS grid template, the header keys, and PRRow's cells. Adding the
 * FINDINGS column meant touching all three, and getting one wrong silently
 * shifts every column after it rather than failing loudly. This pins the two
 * that are checkable statically, plus the i18n label each header needs.
 */
import { describe, it, expect } from "vitest";
import { COLUMN_KEYS, GRID } from "./constants";
import messages from "../../../../../messages/en/prReview.json";

describe("PR list columns", () => {
  it("has one grid track per column key", () => {
    expect(GRID.split(/\s+/).filter(Boolean)).toHaveLength(COLUMN_KEYS.length);
  });

  it("has an i18n label for every column key", () => {
    const labels = messages.list.columns as Record<string, string>;
    for (const key of COLUMN_KEYS) {
      expect(labels[key], `missing list.columns.${key}`).toBeTruthy();
    }
  });

  it("places FINDINGS between SCORE and STATUS", () => {
    expect(COLUMN_KEYS.indexOf("findings")).toBe(COLUMN_KEYS.indexOf("score") + 1);
    expect(COLUMN_KEYS.indexOf("status")).toBe(COLUMN_KEYS.indexOf("findings") + 1);
  });
});
