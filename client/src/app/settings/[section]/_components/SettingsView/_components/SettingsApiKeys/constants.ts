import type { ConnTestProvider } from "../../../../../../../lib/types";

/** One configurable provider key row in the API Keys section. */
export interface KeyRowSpec {
  provider: ConnTestProvider;
  labelKey: string;
  hintKey: string;
}

/**
 * The provider key rows shown in API Keys (OpenAI / Anthropic / OpenRouter).
 * GitHub is deliberately absent: PATs are per-repo now (GitHub Tokens
 * section) — the server rejects `provider: "github"` on
 * `POST /settings/test-connection` with a 422 pointing at `POST
 * /github-tokens/test`, so a row here would just fail.
 */
export const KEY_ROWS: readonly KeyRowSpec[] = [
  { provider: "openai", labelKey: "apiKeys.openaiLabel", hintKey: "apiKeys.openaiHint" },
  { provider: "anthropic", labelKey: "apiKeys.anthropicLabel", hintKey: "apiKeys.anthropicHint" },
  { provider: "openrouter", labelKey: "apiKeys.openrouterLabel", hintKey: "apiKeys.openrouterHint" },
];
