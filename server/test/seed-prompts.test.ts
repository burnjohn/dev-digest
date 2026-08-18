import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  API_CONTRACT_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from '../src/db/seed-prompts.js';

/**
 * `docs/agent-prompts/README.md` says the markdown files there are the canonical,
 * reviewable originals and that the seed constants mirror them. Nothing enforced
 * that, so the two could drift with no signal — a reviewer would approve an edit
 * to the doc while every freshly seeded workspace kept the old prompt.
 *
 * Only the two agents this feature adds are pinned. The three starter prompts
 * predate this check and are not byte-identical to their docs; adopting them
 * into it is a separate change from a separate reading of which side is right.
 */
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'agent-prompts');

const readDoc = (file: string) => readFileSync(join(DOCS, file), 'utf8').replace(/\s+$/, '');

describe('seeded prompts mirror their docs', () => {
  it('test-quality-reviewer', () => {
    expect(TEST_QUALITY_REVIEWER_PROMPT).toBe(readDoc('test-quality-reviewer.md'));
  });

  it('api-contract-reviewer', () => {
    expect(API_CONTRACT_REVIEWER_PROMPT).toBe(readDoc('api-contract-reviewer.md'));
  });
});

describe('the new prompts follow the required reviewer conventions', () => {
  // docs/agent-prompts/README.md — every reviewer prompt must carry a severity
  // rubric on the schema's own enum, a verdict mapping, and findings discipline.
  const prompts = {
    'test-quality': TEST_QUALITY_REVIEWER_PROMPT,
    'api-contract': API_CONTRACT_REVIEWER_PROMPT,
  };

  for (const [name, prompt] of Object.entries(prompts)) {
    it(`${name} uses the schema's severity and verdict vocabulary`, () => {
      for (const severity of ['CRITICAL', 'WARNING', 'SUGGESTION']) {
        expect(prompt).toContain(severity);
      }
      for (const verdict of ['request_changes', 'comment', 'approve']) {
        expect(prompt).toContain(verdict);
      }
      // No competing scale — the model maps High/Medium/Low onto the enum
      // inconsistently and inflates severities.
      expect(prompt).not.toMatch(/\b(High|Medium|Low)\b\s*\//);
    });

    it(`${name} states "no findings ⇒ approve" and forbids padding`, () => {
      // \s+ because the sentence wraps across lines in the doc.
      expect(prompt).toMatch(/No findings ⇒\s+approve/);
      expect(prompt).toMatch(/never pad the/i);
      // "return at most N findings" reads as a quota and gets padded to N.
      expect(prompt).not.toMatch(/at most \d+ findings/i);
    });

    it(`${name} defers its specific checks to the linked skills`, () => {
      expect(prompt).toContain('## Skills / rules');
    });
  }
});
