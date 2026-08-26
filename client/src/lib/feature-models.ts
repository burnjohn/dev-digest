import type { FeatureModelDef } from "./types";

/**
 * Client-local copy of the per-feature model registry.
 *
 * The server's source of truth is `FEATURE_MODELS` in `@devdigest/shared`; this
 * mirrors it so the UI can label features without a round trip. Keep the two in
 * sync by hand.
 *
 * (Historical note: this copy originally existed because the client could only
 * import TYPES from the vendored shared package. That constraint is gone —
 * `experimental.extensionAlias` in `next.config.mjs` lets webpack resolve the
 * barrel's `./contracts/*.js` re-exports, so runtime values import fine now.)
 */
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: "onboarding",
    label: "Onboarding Tour",
    description: "Writes the per-repo onboarding tour.",
    defaultProvider: "openrouter",
    defaultModel: "deepseek/deepseek-v4-flash",
  },
  {
    id: "review_intent",
    label: "PR Review · Intent",
    description: "Derives a PR’s intent and scope before review.",
    defaultProvider: "openrouter",
    defaultModel: "deepseek/deepseek-v4-flash",
  },
  {
    id: "risk_brief",
    label: "Risk Brief",
    description: "Assesses merge risks for a pull request.",
    defaultProvider: "openai",
    defaultModel: "gpt-4.1",
  },
  {
    id: "conformance",
    label: "Conformance",
    description: "Checks a PR against the project spec.",
    defaultProvider: "openai",
    defaultModel: "gpt-4.1",
  },
  {
    id: "conventions",
    label: "Conventions",
    description: "Extracts coding conventions from the repo.",
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
  },
];
