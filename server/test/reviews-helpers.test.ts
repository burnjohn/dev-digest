import { describe, it, expect } from 'vitest';
import { taskLine, intentPromptBlock } from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

/**
 * Coverage for `intentPromptBlock` — the untrusted intent slot (plan
 * 03-intent-layer.md T6 / helpers.ts). REQ-11's byte-identical no-intent path
 * depends on this returning '' for an empty intent.
 */
describe('intentPromptBlock', () => {
  it('returns "" for a fully empty intent, preserving the no-intent byte-identical path', () => {
    const block = intentPromptBlock({ intent: '', in_scope: [], out_of_scope: [] });
    expect(block).toBe('');
  });

  it('renders Summary / In scope / Out of scope sections, with "(none declared)" for an empty list', () => {
    const block = intentPromptBlock({
      intent: 'Adds rate limiting to public endpoints.',
      in_scope: ['src/middleware/ratelimit.ts'],
      out_of_scope: [],
    });
    expect(block).toContain('### Summary');
    expect(block).toContain('Adds rate limiting to public endpoints.');
    expect(block).toContain('### In scope');
    expect(block).toContain('- src/middleware/ratelimit.ts');
    expect(block).toContain('### Out of scope');
    expect(block).toContain('_(none declared)_');
  });
});
