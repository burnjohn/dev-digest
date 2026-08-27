/**
 * Pure helpers behind the agent editor's `Context` tab.
 *
 * Reorder/filter/reconcile/seed-order over the path-keyed row list is NOT
 * re-implemented here — it already exists, generalized for exactly this
 * shape, in `components/context-docs/helpers.ts` (`move`, `shiftPath`,
 * `reconcileOrder`, `filterByPath`, `samePaths`, `orderForDisplay`). This file
 * holds only what is specific to attaching agent context: the two derived
 * numbers the header/footer/warning render.
 */

import type { ContextDocument } from "@/lib/types";

/**
 * Sum of `token_estimate` over ATTACHED documents only — the footer's summed
 * estimate (REQ-15), distinct from a row's own per-document estimate (REQ-6),
 * which `TokenEstimate` renders straight off `document.token_estimate`.
 */
export function sumAttachedTokens(all: ContextDocument[], attached: ReadonlySet<string>): number {
  return all.reduce((sum, d) => (attached.has(d.path) ? sum + d.token_estimate : sum), 0);
}

/**
 * REQ-16 / REQ-42: true once the attached total exceeds 25% of the agent's
 * model's context window. A null/unknown window (`contextLength` absent from
 * `ModelInfo`, e.g. a provider that doesn't report it) means the warning never
 * renders — the caller checks this before rendering the banner, never the
 * other way around, so an unknown window can't be mistaken for "under budget".
 */
export function isOverWindowThreshold(
  attachedTokens: number,
  contextLength: number | null | undefined,
): boolean {
  if (contextLength == null) return false;
  return attachedTokens > contextLength * 0.25;
}
