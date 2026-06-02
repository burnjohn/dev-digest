import type { MemoryKind, MemoryScope } from "@devdigest/shared";

/** Scope filter options. */
export const SCOPES: MemoryScope[] = ["repo", "global", "team"];

/** Kind filter options. */
export const KINDS: MemoryKind[] = ["decision", "convention", "preference", "fact", "learning"];
