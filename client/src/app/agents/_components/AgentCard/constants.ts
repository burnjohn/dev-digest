/** Constants for AgentCard. */

/**
 * Model → chip colour. Falls back to --text-secondary for unknown models.
 *
 * Keys are matched exactly against the agent's `model` field, so a stale key is
 * not a cosmetic issue — every current model falls through to the grey default
 * and the colour coding stops carrying information.
 */
export const MODEL_COLOR: Record<string, string> = {
  "claude-opus-5": "#f59e0b",
  "claude-sonnet-5": "#10b981",
  "claude-haiku-4-5": "#8b5cf6",
  "gpt-4.1": "#3b82f6",
};
