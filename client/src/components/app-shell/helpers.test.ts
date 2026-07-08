import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor — nav-highlight collision fix", () => {
  it('does NOT return "onboarding-tour" for the unrelated /onboarding add-repo route', () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
  });

  it('returns "onboarding-tour" for the repo-scoped /repos/:repoId/onboarding-tour route', () => {
    expect(activeKeyFor("/repos/x/onboarding-tour")).toBe("onboarding-tour");
  });

  it("still matches /context correctly (no collision introduced)", () => {
    expect(activeKeyFor("/repos/x/context")).toBe("context");
  });

  it("still matches /pulls correctly (no collision introduced)", () => {
    expect(activeKeyFor("/repos/x/pulls")).toBe("pulls");
  });
});
