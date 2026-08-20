import type { ConventionStatus } from "@devdigest/shared";

/** Triage filters, in the order the chips appear. `all` is the widened view. */
export const FILTERS = ["pending", "accepted", "rejected", "all"] as const;
export type ConventionFilter = (typeof FILTERS)[number];

/** Filter → the statuses it shows. `all` shows everything. */
export const FILTER_STATUSES: Record<ConventionFilter, ConventionStatus[] | null> = {
  pending: ["pending"],
  accepted: ["accepted"],
  rejected: ["rejected"],
  all: null,
};

export const SKELETON_CARDS = 3;

/** Confidence bar colour thresholds — mirrors ConfidenceNum's own bands. */
export const CONFIDENCE_OK = 0.85;
export const CONFIDENCE_WARN = 0.65;
