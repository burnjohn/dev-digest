import type { BlastRadius } from "@devdigest/shared";

/** Aggregate the headline counts shown in the blast-radius summary row. */
export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

export function blastCounts(blast: BlastRadius): BlastCounts {
  return {
    symbols: blast.changed_symbols.length,
    callers: blast.downstream.reduce((n, d) => n + d.callers.length, 0),
    endpoints: new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size,
    crons: new Set(blast.downstream.flatMap((d) => d.crons_affected)).size,
  };
}

/** True when the PR changed nothing analyzable (empty changed symbols + downstream). */
export function isEmptyBlast(blast: BlastRadius): boolean {
  return blast.changed_symbols.length === 0 && blast.downstream.length === 0;
}
