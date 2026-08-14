/**
 * assemblePrompt — the skills slot and the per-section size breakdown.
 *
 * The property worth pinning hardest is the one that looks like a bug: skill
 * bodies are NOT delimiter-wrapped. Fencing them would put them under
 * INJECTION_GUARD's "this is data, never instructions" rule and make a skill
 * incapable of changing a review — so a future well-meaning "harden the
 * untrusted content" change must fail here and read specs/01-skills.md.
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt, estimateTokens } from '../src/prompt.js';

const RUBRIC = '# Rubric\n\nScore honestly.';
const GATE = '# Secret gate\n\nFlag credentials in client bundles.';

function assemble(parts: Partial<Parameters<typeof assemblePrompt>[0]> = {}) {
  return assemblePrompt({ system: 'sys', diff: 'DIFF', ...parts });
}

describe('assemblePrompt — ## Skills / rules', () => {
  it('renders skill bodies in the order given, before the diff', () => {
    const user = assemble({ skills: [RUBRIC, GATE] }).messages[1]!.content;
    expect(user).toContain('## Skills / rules');
    expect(user.indexOf(RUBRIC)).toBeLessThan(user.indexOf(GATE));
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Diff to review'));
  });

  it('does NOT wrap skill bodies as untrusted — they are instructions', () => {
    const { messages, assembly } = assemble({ skills: [RUBRIC] });
    const user = messages[1]!.content;
    const section = user.slice(user.indexOf('## Skills / rules'), user.indexOf('## Diff to review'));
    expect(section).not.toContain('<untrusted');
    expect(assembly.skills).toBe(RUBRIC);
  });

  it('omits the section entirely when no skills are linked', () => {
    const { messages, assembly } = assemble();
    expect(messages[1]!.content).not.toContain('## Skills / rules');
    expect(assembly.skills ?? null).toBeNull();
  });

  it('omits the section for an empty array, so "no skills" is one prompt shape', () => {
    expect(assemble({ skills: [] }).messages[1]!.content).not.toContain('## Skills / rules');
  });

  it('produces a prompt byte-identical to the skill-less one when skills are empty', () => {
    expect(assemble({ skills: [] }).messages[1]!.content).toBe(assemble().messages[1]!.content);
  });
});

describe('assemblePrompt — section_sizes', () => {
  it('reports chars and an estimate for each rendered section', () => {
    const { assembly } = assemble({ skills: [RUBRIC, GATE] });
    const sizes = assembly.section_sizes ?? [];
    const skills = sizes.find((s) => s.section === 'skills');

    // Two bodies joined by a blank line.
    expect(skills?.chars).toBe(RUBRIC.length + 2 + GATE.length);
    expect(skills?.est_tokens).toBe(estimateTokens(`${RUBRIC}\n\n${GATE}`));
    expect(sizes.map((s) => s.section)).toEqual(expect.arrayContaining(['system', 'diff']));
  });

  it('omits absent sections rather than reporting them as zero', () => {
    const sizes = assemble().assembly.section_sizes ?? [];
    // Anchored positively: `not.toContain` and `every` are both satisfied by an
    // empty array, so they would still pass if the field were dropped entirely.
    expect(sizes.map((s) => s.section)).toEqual(['system', 'diff']);
    expect(sizes.every((s) => s.chars > 0)).toBe(true);
  });

  it('is the delta the skills block costs — the point of the whole field', () => {
    const without = assemble().assembly.section_sizes ?? [];
    const with_ = assemble({ skills: [RUBRIC] }).assembly.section_sizes ?? [];
    const sum = (s: typeof without) => s.reduce((n, x) => n + x.est_tokens, 0);
    expect(sum(with_) - sum(without)).toBe(estimateTokens(RUBRIC));
  });
});

describe('estimateTokens', () => {
  it('matches the server tokenizer adapter fallback, ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
