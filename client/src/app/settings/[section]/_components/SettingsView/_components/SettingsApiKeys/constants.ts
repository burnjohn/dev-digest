import type { ConnTestProvider } from "@/lib/types";

/** One configurable provider key row in the API Keys section. */
export interface KeyRowSpec {
  provider: ConnTestProvider;
  labelKey: string;
  hintKey: string;
}

/** The provider key rows shown in API Keys (OpenAI / Anthropic / GitHub). */
export const KEY_ROWS: readonly KeyRowSpec[] = [
  { provider: "openai", labelKey: "apiKeys.openaiLabel", hintKey: "apiKeys.openaiHint" },
  { provider: "anthropic", labelKey: "apiKeys.anthropicLabel", hintKey: "apiKeys.anthropicHint" },
  { provider: "openrouter", labelKey: "apiKeys.openrouterLabel", hintKey: "apiKeys.openrouterHint" },
  { provider: "github", labelKey: "apiKeys.githubLabel", hintKey: "apiKeys.githubHint" },
];
