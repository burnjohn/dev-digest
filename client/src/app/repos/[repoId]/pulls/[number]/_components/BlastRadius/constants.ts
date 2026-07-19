/** Constants for the Blast Radius viewer. */

import type { Icon } from "@devdigest/ui";
import type { CallerRole } from "@devdigest/shared";

/** Toggleable view modes for the blast radius (tree drill-down vs node-link graph). */
export type BlastView = "tree" | "graph";
export const BLAST_VIEWS: readonly BlastView[] = ["tree", "graph"];

/**
 * Caller-role visual metadata. Color communicates prod impact at a glance:
 *   business — accent (real product surface), test — violet, boilerplate — muted.
 * `normal` has no tag (default text) to keep the tree quiet. Labels/help are i18n.
 */
export const ROLE_META: Record<
  CallerRole,
  { readonly color: string; readonly tag: boolean }
> = {
  business: { color: "var(--accent-text)", tag: true },
  test: { color: "#a78bfa", tag: true },
  boilerplate: { color: "var(--text-muted)", tag: true },
  normal: { color: "var(--text-secondary)", tag: false },
};

/** Call-site risk chips (deterministic; no model). */
export const RISK = {
  loop: { icon: "Zap" as keyof typeof Icon, color: "var(--warn)" },
  throws: { icon: "AlertTriangle" as keyof typeof Icon, color: "var(--warn)" },
} as const;

/** Summary stat icon for each metric (changed symbols / callers / endpoints / crons). */
export const STAT_ICONS: { readonly icon: keyof typeof Icon; readonly key: string }[] = [
  { icon: "Code", key: "symbols" },
  { icon: "CornerDownRight", key: "callers" },
  { icon: "Globe", key: "endpoints" },
  { icon: "Clock", key: "crons" },
];

/** Node-link graph layout geometry. */
export const GRAPH = {
  width: 560,
  minHeight: 160,
  rootX: 70,
  callerX: 290,
  endpointX: 500,
  rowGap: 42,
  nodeWidth: 110,
  endpointNodeWidth: 120,
} as const;
