import type { CommunitySkill } from '@devdigest/shared';

/**
 * CURATED LOCAL FIXTURE — community skill catalog.
 *
 * This is a hand-vetted, in-repo list (NOT a live registry call). It stands in
 * for a future real source (e.g. a public GitHub topic search). Each entry is
 * deliberately marked as community-sourced so that, on import, the skill lands
 * DISABLED and must be explicitly vetted + enabled before an agent can use it
 * (§11 prompt-injection hardening — community skills are untrusted by default).
 */
export const COMMUNITY_SKILLS: CommunitySkill[] = [
  {
    name: 'security-review-baseline',
    repo: 'devdigest-community/security-skills',
    stars: 1843,
    lang: 'TypeScript',
    desc: 'Baseline security rubric: secret leakage, SSRF, injection, and lethal-trifecta heuristics for PR review.',
  },
  {
    name: 'perf-nplus1-detector',
    repo: 'devdigest-community/perf-skills',
    stars: 921,
    lang: 'TypeScript',
    desc: 'Flags N+1 query patterns, missing indexes, and unbounded loops in changed code paths.',
  },
  {
    name: 'rest-api-conventions',
    repo: 'acme-oss/api-style',
    stars: 412,
    lang: 'Go',
    desc: 'House conventions for REST handlers: error envelopes, pagination, idempotency keys, status codes.',
  },
  {
    name: 'react-hooks-rubric',
    repo: 'devdigest-community/frontend-skills',
    stars: 654,
    lang: 'TypeScript',
    desc: 'Reviews React hook usage: dependency arrays, effect cleanup, render-time side effects.',
  },
  {
    name: 'test-coverage-gate',
    repo: 'devdigest-community/quality-skills',
    stars: 308,
    lang: 'Python',
    desc: 'Checks that new logic ships with tests and that critical branches are covered before approval.',
  },
];
