import type { IconName } from "@devdigest/ui";
import type { MemoryKind, MemoryScope } from "@devdigest/shared";

/** Per-kind accent colour + icon. Shared by MemoryCard and MemoryDetail. */
export const MEM_KIND: Record<MemoryKind, { c: string; icon: IconName }> = {
  decision: { c: "#3b82f6", icon: "GitMerge" },
  convention: { c: "#10b981", icon: "ListChecks" },
  preference: { c: "#f59e0b", icon: "User" },
  fact: { c: "#999999", icon: "Info" },
  learning: { c: "#8b5cf6", icon: "Brain" },
};

/** Per-scope accent colour. Shared by MemoryCard and MemoryDetail. */
export const MEM_SCOPE: Record<MemoryScope, string> = {
  repo: "#3b82f6",
  global: "#f59e0b",
  team: "#8b5cf6",
};

/** Days after which a memory is considered stale (mirrors backend default). */
export const STALE_DAYS = 60;
