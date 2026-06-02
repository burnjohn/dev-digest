import { MODEL_COLOR } from "./constants";

/** Resolve the chip colour for an agent's model (unknown → secondary token). */
export function modelColor(model: string): string {
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}
