import type { Provider } from "@devdigest/shared";

/** Default provider/model for a new agent. */
export const DEFAULT_PROVIDER: Provider = "openai";
export const DEFAULT_MODEL = "gpt-4.1";

/** Selectable providers in the create form. */
export const PROVIDER_OPTIONS: readonly Provider[] = ["openai", "anthropic"];

/** Modal width (px). */
export const MODAL_WIDTH = 620;
