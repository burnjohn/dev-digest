import type { Provider } from "@devdigest/shared";

/** Selectable providers in the Config tab. */
export const PROVIDER_OPTIONS: readonly Provider[] = ["openai", "anthropic"];

/** Output-schema options (only one supported in MVP). */
export const OUTPUT_SCHEMA_VALUE = "Standard findings JSON";
