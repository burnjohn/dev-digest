import { describe, it, expect } from "vitest";
import { resolveTab, didRunsSettle } from "./helpers";

describe("resolveTab", () => {
  it("accepts each known tab", () => {
    expect(resolveTab("overview")).toBe("overview");
    expect(resolveTab("findings")).toBe("findings");
    expect(resolveTab("diff")).toBe("diff");
  });

  it("falls back to overview for unknown values", () => {
    expect(resolveTab("bogus")).toBe("overview");
    expect(resolveTab("")).toBe("overview");
  });

  it("falls back to overview when the param is absent", () => {
    expect(resolveTab(null)).toBe("overview");
  });
});

describe("didRunsSettle", () => {
  it("is true when a previously-live run left the active set", () => {
    expect(didRunsSettle("a,b", "b")).toBe(true);
    expect(didRunsSettle("a", "")).toBe(true);
  });

  it("is false when nothing was live before", () => {
    expect(didRunsSettle("", "")).toBe(false);
    expect(didRunsSettle("", "a")).toBe(false);
  });

  it("is false while the same runs stay live (or new ones start)", () => {
    expect(didRunsSettle("a", "a")).toBe(false);
    expect(didRunsSettle("a", "a,b")).toBe(false);
  });
});
