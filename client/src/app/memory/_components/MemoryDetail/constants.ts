import type { MemoryKind, MemoryScope } from "@devdigest/shared";

/** Editable kind options (order preserved from the original component). */
export const KINDS: MemoryKind[] = ["decision", "convention", "preference", "fact", "learning"];

/** Editable scope options. */
export const SCOPES: MemoryScope[] = ["repo", "global", "team"];
