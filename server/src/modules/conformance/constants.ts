import type { Provider } from '@devdigest/shared';

/** Default model for anthropic-provider conformance runs. */
export const DEFAULT_MODEL_ANTHROPIC = 'claude-3-5-sonnet';

/** Default model for all other providers (openai et al). */
export const DEFAULT_MODEL_OPENAI = 'gpt-4.1';

/** Fallback provider when the input doesn't specify one. */
export const DEFAULT_PROVIDER: Provider = 'openai';

/** code_chunks source tag identifying Project-Context spec chunks. */
export const SPEC_SOURCE = 'spec';

/** Max spec chunks loaded per conformance run. */
export const SPEC_CHUNK_LIMIT = 20;
