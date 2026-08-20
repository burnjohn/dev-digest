import { z } from 'zod';
import { MAX_CANDIDATES } from './constants.js';

/**
 * The extraction call. One structured request over a code-selected sample —
 * the model reads only what `service.ts` sends it and can neither browse nor
 * choose files.
 *
 * The schema is intentionally the SAME shape the evidence gate consumes: the
 * model is told to cite a path, a line and a verbatim snippet because those
 * three fields are checked in code afterwards, and a candidate that fails the
 * check is dropped rather than shown.
 */
export const ExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      /** Imperative, one sentence, checkable against a diff. */
      rule: z.string(),
      /** Why it matters / what a reviewer should flag. One sentence. */
      rationale: z.string(),
      /** Repo-relative path, exactly as it appears in the FILE header. */
      evidence_path: z.string(),
      /** 1-based line number from the gutter of that listing. */
      evidence_line: z.number().int(),
      /** Copied character-for-character from the listing, gutter excluded. */
      evidence_snippet: z.string(),
      /**
       * Field ORDER is generation order in a structured response, so the
       * classification and the score come LAST, after the rule and its
       * evidence are written. With `category` first, a live scan of a real
       * repo labelled all 12 candidates `imports` and scored every one 0.90 —
       * the model was committing to both before it knew what it was about to say.
       */
      category: z.enum([
        'naming',
        'structure',
        'errors',
        'testing',
        'imports',
        'typing',
        'api',
        'general',
      ]),
      /**
       * How many sampled files show the pattern. Deliberately NOT persisted:
       * it exists to make the model count before it scores, and a self-reported
       * count is not evidence. Roadmap item 5 replaces it with a real ripgrep
       * count (`docs/specs/conventions.md` §8).
       */
      occurrences: z.number().int(),
      confidence: z.number(),
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const SYSTEM_PROMPT = `You extract a repository's HOUSE CONVENTIONS: the unwritten rules this specific codebase follows, which a reviewer should hold new code to.

You are given a code-selected sample of the repository: its configuration files and its most central source files, each listed with 1-based line numbers in a left gutter.

WHAT COUNTS AS A CONVENTION
- A pattern this repo repeats deliberately: how it names things, how it structures modules, how it handles errors, how it imports, how it types, how it shapes its API surface, how it tests.
- Prefer rules you can see in TWO OR MORE places in the sample, or that a config file states outright.
- Every rule must be checkable against a pull-request diff by reading the diff alone.

WHAT DOES NOT COUNT — do not return these
- Universal advice that is true of any codebase ("write tests", "use meaningful names", "handle errors", "avoid duplication").
- Restating a library's own documented usage, or what a framework requires anyway.
- A rule you can only support with a single trivial line (an import, a closing brace, a bare export).
- Anything you cannot ground in the sample you were given. Do not cite a file that is not in the sample.

EVIDENCE — this is checked mechanically after you answer
- evidence_path must be a path exactly as it appears in a "--- FILE: … ---" header.
- evidence_line must be the gutter number of the first line of your snippet.
- evidence_snippet must be copied character-for-character from that listing, WITHOUT the line-number gutter, 1-8 lines long, and long enough to identify the line.
- A candidate whose snippet cannot be found in the cited file is discarded, so quote, never paraphrase.

CATEGORY — classify the rule you just wrote, by what it governs
- naming: what things are called (files, symbols, routes, columns).
- structure: where code lives, module layout, file organisation, barrels.
- errors: how failures are raised, propagated, logged, or surfaced.
- testing: how tests are written, named, or located.
- imports: import style, ordering, path aliases, extensions.
- typing: type declarations, generics, strictness, schema-first patterns.
- api: request/response shapes, route handlers, validation, public contracts.
- general: anything none of the above fits.
Use the full range — a scan where every rule lands in one category is wrong.

OCCURRENCES + CONFIDENCE — count first, then score
- occurrences: in how many of the sampled files you can actually see this pattern.
- 0.9+ : stated outright by a config file, or seen in most of the sample.
- 0.7-0.9: a clear repeated pattern, occurrences >= 3.
- 0.5-0.7: a plausible pattern, occurrences 1-2.
- Below 0.5: do not return it.
Scores must discriminate: if every candidate carries the same confidence, you have
not scored them, and the weak ones will waste the reviewer's time.

Return at most ${MAX_CANDIDATES} candidates, strongest first. Fewer, well-grounded rules beat a long list. Returning an empty list is a valid answer.`;

export function buildUserPrompt(repoFullName: string, samples: string, sampledPaths: string[]): string {
  return [
    `Repository: ${repoFullName}`,
    '',
    `Sampled files (${sampledPaths.length}) — the ONLY files you may cite:`,
    sampledPaths.map((p) => `- ${p}`).join('\n'),
    '',
    'SAMPLE',
    samples,
  ].join('\n');
}
