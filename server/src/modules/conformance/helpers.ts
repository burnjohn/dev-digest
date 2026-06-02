import type { Provider } from '@devdigest/shared';
import { DEFAULT_MODEL_ANTHROPIC, DEFAULT_MODEL_OPENAI } from './constants.js';

/** Default model for a provider (anthropic → sonnet, otherwise gpt-4.1). */
export function defaultModel(provider: Provider): string {
  return provider === 'anthropic' ? DEFAULT_MODEL_ANTHROPIC : DEFAULT_MODEL_OPENAI;
}

/** Derive a human-readable spec title from a spec file path. */
export function specTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base
    .replace(/\.(prd\.)?md$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
