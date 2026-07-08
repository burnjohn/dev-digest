/** Constants for AgentCard. */

/** Model → chip colour. Falls back to --text-secondary for unknown models. */
export const MODEL_COLOR: Record<string, string> = {
  "gpt-4.1": "#3b82f6",
  "gpt-4o": "#10b981",
  "gpt-4o-mini": "#8b5cf6",
  o1: "#f59e0b",
};

/** Accept rate (%) at/above which the figure is shown green, below which amber. */
export const ACCEPT_OK_THRESHOLD = 60;
