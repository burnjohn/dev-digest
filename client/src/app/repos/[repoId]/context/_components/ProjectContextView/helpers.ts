import type { ContextDocument } from "@/lib/types";
import { ApiError } from "@/lib/api";

/**
 * Flat, path-sorted document list — the owner's binding layout decision
 * (SPEC-01 plan, T8): the page renders every document as one alphabetically
 * ordered list keyed on its repository-relative path, never a nested folder
 * tree. Server order is not relied upon; this is the single source of the
 * page's row order.
 */
export function sortByPath(documents: ContextDocument[]): ContextDocument[] {
  return [...documents].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Summed token estimate across every document the page currently lists — the
 * middle term of the left pane's footer (`N documents · Nt · refreshed … ago`).
 *
 * Distinct from a `Context` tab's footer estimate, which sums only the
 * *attached* subset (REQ-15): this page attaches nothing, so its total is over
 * the whole listing.
 */
export function totalTokens(documents: ContextDocument[]): number {
  return documents.reduce((sum, d) => sum + d.token_estimate, 0);
}

/** `ApiError.message` when the failure carries one; `undefined` otherwise —
    lets a caller build `t("error", { message })` without a raw error object
    leaking into the translated string. */
export function errorMessage(error: unknown): string | undefined {
  return error instanceof ApiError ? error.message : undefined;
}
