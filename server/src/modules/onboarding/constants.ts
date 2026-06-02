/**
 * A3 — onboarding generator constants (extracted from service.ts; no behaviour change).
 */
import type { Provider } from '@devdigest/shared';

/** The fixed 5-section onboarding plan (kind/title/RAG query per section). */
export const SECTION_PLAN: { kind: string; title: string; query: string }[] = [
  { kind: 'overview', title: 'Overview', query: 'what does this project do, purpose, product vision, README' },
  { kind: 'architecture', title: 'Architecture', query: 'architecture, layers, modules, data flow, services, adapters' },
  { kind: 'modules', title: 'Key Modules', query: 'main modules, packages, directories, entry points, routes' },
  { kind: 'getting-started', title: 'Getting Started', query: 'install, run, dev server, scripts, environment variables, setup' },
  { kind: 'conventions', title: 'Conventions & Gotchas', query: 'conventions, patterns, testing, gotchas, do not edit, tenancy' },
];

/** Default provider/model + retry budget for the section-writing LLM pass. */
export const ONBOARDING_PROVIDER: Provider = 'openai';
export const ONBOARDING_MODEL = 'gpt-4.1';
export const ONBOARDING_MAX_RETRIES = 1;

/** System prompt for writing a single onboarding section. */
export const SECTION_SYSTEM_PROMPT =
  'You write ONE section of a developer onboarding tour for a codebase. Output: a concise markdown `body` (3-6 short paragraphs or a tight bullet list), an optional mermaid `diagram` (only for the Architecture section, else null), and up to 4 `links` ({label, path}) pointing at real files from the provided context/tree. Ground every claim in the provided context — do not invent file paths. Keep it skimmable.';

/** RAG retrieval tuning. */
export const RETRIEVE_TOP_K = 5;
export const KEYWORD_SCAN_LIMIT = 50;
export const MIN_TOKEN_LEN = 3;
export const MAX_QUERY_TOKENS = 4;

/** Skeleton-fallback tuning (no-LLM path). */
export const SKELETON_EXCERPT_CHARS = 400;
export const MAX_SECTION_LINKS = 4;
export const SKELETON_LINK_RE = /readme|index|architecture|package\.json|config/i;

/** File-tree walk limits. */
export const TREE_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);
export const TREE_MAX_DEPTH = 2;
export const TREE_MAX_ENTRIES = 120;
export const TREE_MAX_FILE_BYTES = 2_000_000;
