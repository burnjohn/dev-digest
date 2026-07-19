/** Constants for the Blast Radius viewer. */

import type { Icon } from "@devdigest/ui";

/** Toggleable view modes for the blast radius (tree drill-down vs node-link graph). */
export type BlastView = "tree" | "graph";
export const BLAST_VIEWS: readonly BlastView[] = ["tree", "graph"];

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
