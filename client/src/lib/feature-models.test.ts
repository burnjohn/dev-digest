import { describe, expect, it } from "vitest";
import { FEATURE_MODELS } from "./feature-models";

describe("FEATURE_MODELS — review_intent default (T5, REQ-2)", () => {
  it("pins the cheap-model default to openrouter/deepseek-v4-flash, in lockstep with the server registry", () => {
    const entry = FEATURE_MODELS.find((m) => m.id === "review_intent");
    expect(entry).toBeDefined();
    expect(entry?.defaultProvider).toBe("openrouter");
    expect(entry?.defaultModel).toBe("deepseek/deepseek-v4-flash");
  });
});
