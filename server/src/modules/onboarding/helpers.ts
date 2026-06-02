/**
 * A3 — pure helpers for the onboarding generator (extracted from service.ts; no
 * behaviour change). Side-effect free; operate purely on their arguments.
 */
import type { OnboardingSection } from '@devdigest/shared';
import {
  MAX_QUERY_TOKENS,
  MAX_SECTION_LINKS,
  MIN_TOKEN_LEN,
  SKELETON_EXCERPT_CHARS,
  SKELETON_LINK_RE,
} from './constants.js';

/** Split a RAG query into the keyword tokens used by the ILIKE fallback. */
export function queryTokens(query: string): string[] {
  return query
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > MIN_TOKEN_LEN)
    .slice(0, MAX_QUERY_TOKENS);
}

/** Score chunk contents by how many query tokens they mention; top-k descending. */
export function scoreChunks(
  rows: { content: string }[],
  tokens: string[],
  topK: number,
): string[] {
  return rows
    .map((r) => ({
      content: r.content,
      score: tokens.reduce((n, tok) => n + (r.content.toLowerCase().includes(tok) ? 1 : 0), 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.content);
}

/** Deterministic fallback so onboarding always yields a well-formed section. */
export function skeletonSection(
  plan: { kind: string; title: string },
  context: string[],
  tree: string[],
): OnboardingSection {
  const excerpt = context[0]?.slice(0, SKELETON_EXCERPT_CHARS);
  const body = excerpt
    ? `_Generated without an LLM (no API key configured)._\n\nRelevant context for **${plan.title}**:\n\n> ${excerpt.replace(/\n/g, ' ')}`
    : `_Generated without an LLM and with no indexed context yet._\n\nRe-index the project context and configure an OpenAI key, then regenerate to populate the **${plan.title}** section.`;
  const links = tree
    .filter((p) => SKELETON_LINK_RE.test(p))
    .slice(0, MAX_SECTION_LINKS)
    .map((p) => ({ label: p.split('/').pop() ?? p, path: p }));
  return { kind: plan.kind, title: plan.title, body, diagram: null, links };
}
