import type { FeatureModelDef } from "./types";

/**
 * Client-local copy of the per-feature model registry.
 *
 * The server's source of truth is `FEATURE_MODELS` in `@devdigest/shared`, but
 * the client can only import TYPES from the vendored shared package — importing
 * a runtime VALUE pulls `vendor/shared/index.ts` into the webpack bundle, whose
 * `./contracts/*.js` re-exports Next's webpack can't resolve. So we mirror the
 * registry here (same pattern as the vendored `vendor/shared` / `vendor/ui`).
 * Keep this in sync with the shared registry.
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
    defaultModel: "gpt-5.4",
  },
];
