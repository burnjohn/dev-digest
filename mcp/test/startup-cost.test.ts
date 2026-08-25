import { describe, expect, it } from 'vitest';
import { measureStartupCost } from '../scripts/measure-startup-tokens.js';

/**
 * T12 — pins `deferred_startup_tokens` (§5.10, REQ-27) under a committed
 * ceiling so an `instructions` rewrite, or a sixth model-facing string,
 * fails CI instead of quietly taxing every session that loads this server.
 *
 * MEASURED 149 tokens on 2026-08-23 (`cd mcp && npm run measure`, five tools
 * + the frozen `instructions` string, §5.13). The ceiling below is that
 * number plus ~15% headroom (149 * 1.15 ≈ 171 → 175) — enough slack that a
 * one-word `instructions` clarification does not fail this test, not enough
 * that a real rewrite (a sixth tool, a paragraph added to `instructions`)
 * passes silently. If this genuinely needs to move, re-measure, update BOTH
 * this comment and the ceiling together, and say why in the commit.
 */
const DEFERRED_STARTUP_TOKENS_CEILING = 175;

describe('startup token cost (§5.10, REQ-27) — measured with buildServer(deps), no transport, no network', () => {
  it('deferred_startup_tokens (names + instructions) stays under the committed ceiling', () => {
    const { deferredStartupTokens } = measureStartupCost();

    expect(deferredStartupTokens).toBeGreaterThan(0);
    expect(
      deferredStartupTokens,
      `deferred_startup_tokens is ${deferredStartupTokens}, over the committed ceiling of ` +
        `${DEFERRED_STARTUP_TOKENS_CEILING}. If this is a genuine, reviewed increase (not an ` +
        'accidental instructions/tool-name bloat), re-measure with `cd mcp && npm run measure`, then ' +
        'raise the ceiling here AND in mcp/README.md together.',
    ).toBeLessThanOrEqual(DEFERRED_STARTUP_TOKENS_CEILING);
  });

  it('full_schema_tokens (the alwaysLoad counterfactual, REQ-8) is strictly larger than the deferred number', () => {
    const { deferredStartupTokens, fullSchemaTokens } = measureStartupCost();

    // The whole point of tool search + deferred loading is that this gap is
    // large — if it ever collapsed to ~0 something upstream (the SDK, or
    // this script's own introspection) broke, silently making the deferred
    // number meaningless.
    expect(fullSchemaTokens).toBeGreaterThan(deferredStartupTokens);
  });

  it('registers exactly the five D-D tools this measurement counts', () => {
    const { tools } = measureStartupCost();

    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
  });
});
