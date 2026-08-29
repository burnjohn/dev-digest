import { describe, it, expect } from 'vitest';
import {
  EVAL_BASELINE_SYSTEM_PROMPT,
  evalBaselineConfig,
} from '../src/modules/evals/constants.js';

/**
 * T-B (SPEC-03 AC-72/AC-73) — the agent-free skill eval baseline, hermetic
 * half. Deciding WHICH prompt and WHICH model a skill-owned case's arms use
 * is pure logic (`evalBaselineConfig`) and needs no database — the same
 * boundary T4's scorer already uses (`evals-scoring.test.ts`). The `.it`
 * lane (`evals-skill-cases.it.test.ts`) only has to prove the wiring: that
 * `service.ts` actually calls `resolveEvalBaselineModel` and this function,
 * and passes the result through to both arms.
 */

const EXPECTED_PROMPT =
  'You are reviewing a unified diff from a pull request as an experienced software engineer.\n' +
  '\n' +
  'Report only defects this diff introduces or makes worse. Pre-existing problems, and code the diff does not touch, are out of scope.\n' +
  '\n' +
  'Report a finding only when you can name the concrete mechanism by which it fails — the input, state, or sequence that produces the wrong result. Do not report style, naming, formatting, or speculative concerns.\n' +
  '\n' +
  'An empty findings list is a valid and correct answer for a diff that contains no defect. Do not add findings to fill the response.';

describe('evalBaselineConfig (AC-72/AC-73)', () => {
  it('AC-72 — EVAL_BASELINE_SYSTEM_PROMPT is byte-identical to the spec fenced text', () => {
    expect(EVAL_BASELINE_SYSTEM_PROMPT).toBe(EXPECTED_PROMPT);
    // Independent length/paragraph-count check — catches an accidental
    // trailing/leading whitespace or a merged/split paragraph a plain
    // string-equality diff can be hard to eyeball.
    expect(EVAL_BASELINE_SYSTEM_PROMPT.split('\n\n')).toHaveLength(4);
    expect(EVAL_BASELINE_SYSTEM_PROMPT.startsWith('You are reviewing a unified diff')).toBe(true);
    expect(EVAL_BASELINE_SYSTEM_PROMPT.endsWith('Do not add findings to fill the response.')).toBe(
      true,
    );
  });

  it('AC-72 — the constant carries the mandatory precision-bar clause verbatim', () => {
    // AC-72's own note: paragraph 3 is "the precision bar" and removing it
    // would silently destroy the with/without lift measurement — pin its
    // exact wording so a future "tightening" edit fails loudly here first.
    expect(EVAL_BASELINE_SYSTEM_PROMPT).toContain(
      'Report a finding only when you can name the concrete mechanism by which it fails',
    );
  });

  it('AC-73 — resolves the given provider/model into the one baseline config both arms share', () => {
    const config = evalBaselineConfig({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });
    expect(config).toEqual({
      systemPrompt: EVAL_BASELINE_SYSTEM_PROMPT,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
  });

  it('AC-72/AC-73 — the prompt never varies with the resolved model; only provider/model do', () => {
    const openrouterDefault = evalBaselineConfig({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
    const workspaceOverride = evalBaselineConfig({ provider: 'openai', model: 'gpt-4.1' });

    expect(openrouterDefault.systemPrompt).toBe(workspaceOverride.systemPrompt);
    expect(openrouterDefault.systemPrompt).toBe(EVAL_BASELINE_SYSTEM_PROMPT);
    expect(openrouterDefault.provider).not.toBe(workspaceOverride.provider);
    expect(openrouterDefault.model).not.toBe(workspaceOverride.model);
  });
});
