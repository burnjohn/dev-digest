import type { IntentClassification } from '@devdigest/shared';
import type { ContainerOverrides } from '../../src/platform/container.js';
import { INTENT_SCHEMA_NAME } from '../../src/modules/reviews/intent-classifier.js';
import { MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../../src/adapters/mocks.js';

/**
 * Closes the `.it` lane's three live-network channels (plan 04, FIX 3):
 *
 * 1. `secrets` — neutralises BOTH the hardcoded `secretsPath`
 *    (`platform/config.ts:74`, `~/.devdigest/secrets.json`) and the
 *    `process.env` fallback (`adapters/secrets/local.ts:37-42`, populated by
 *    `dotenv/config` reading `server/.env`). Without this override a real
 *    `OPENROUTER_API_KEY`/`GITHUB_TOKEN` on the dev box is used.
 * 2. `github` — the intent step's `gatherIntentSources` calls `getIssue` for
 *    any "Closes #NNN" PR body (`reviews.it.test.ts`'s fixture does exactly
 *    that); an unmocked `github` makes a real call.
 * 3. `llm.openrouter` — `resolveFeatureModel(..., 'review_intent')` defaults
 *    to `openrouter`, so every review-path `.it` test that never explicitly
 *    injected `llm.openrouter` made a real, billed completion for the intent
 *    step alone.
 */

/** Sentinel-prefixed so a fixture leak into a prompt dump is unmistakable. */
export const INTENT_FIXTURE: IntentClassification = {
  intent: '[HERMETIC-FIXTURE] Adds rate limiting to public API endpoints.',
  in_scope: ['rate limiting middleware'],
  out_of_scope: ['authentication'],
  confidence: 'medium',
};

/**
 * A dedicated `MockLLMProvider('openrouter', …)` — never the caller's
 * `openai`/`anthropic` mock. Keyed by `structuredBySchema` only, with NO
 * `structured` fallback: any call for a schema other than
 * `IntentClassification` routed through this instance throws instead of
 * silently receiving the intent fixture (`MockLLMProvider.completeStructured`
 * resolves `structuredBySchema?.[name] ?? structured ?? {}` —
 * `server/INSIGHTS.md`, 2026-08-17).
 */
export function intentLlm(fixture: IntentClassification = INTENT_FIXTURE): MockLLMProvider {
  return new MockLLMProvider('openrouter', {
    structuredBySchema: { [INTENT_SCHEMA_NAME]: fixture },
  });
}

/**
 * Wraps a test's `overrides` object with the three hermetic defaults above.
 * Caller overrides win per key — EXCEPT `llm`, which MERGES rather than
 * replaces: a caller passing `llm: { openai: reviewMock }` still keeps the
 * intent mock on `openrouter`, on its own provider instance.
 */
export function hermeticOverrides(overrides: ContainerOverrides = {}): ContainerOverrides {
  return {
    secrets: new MockSecretsProvider(),
    github: new MockGitHubClient(),
    ...overrides,
    llm: { openrouter: intentLlm(), ...overrides.llm },
  };
}
