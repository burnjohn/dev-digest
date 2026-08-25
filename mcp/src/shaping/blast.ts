import type { BlastRadiusResponse } from '@devdigest/shared';
import type {
  BlastChipSummaryShape,
  BlastSymbolSummaryShape,
  GetBlastRadiusOutputResult,
} from '../schemas/blast.js';
import { MAX_BLAST_CHIPS, MAX_BLAST_SYMBOLS } from './constants.js';

/**
 * `get_blast_radius`'s projection (ring M2, REQ-18, docs/plans/06-blast-radius.md)
 * — the server's `BlastRadiusResponse` (`server/src/vendor/shared/contracts/blast-api.ts`)
 * is a Tree DTO built for a UI card: per-symbol caller LISTS with `file:line`
 * and `rank`, a depth-bounded `file_impact[]` reverse-import walk, `prior_prs[]`
 * with per-row overlap detail, and an optional LLM `narrative`. None of that
 * earns its tokens in a tool response read by a model, so this file is
 * explicit about what survives and what is cut, mirroring the discipline
 * `mcp/src/shaping/project.ts` already applies to findings.
 *
 * KEPT: `status` / `status_reason` (a degraded answer must say so), the four
 * `totals` (the mockup's own count strip — cheap and load-bearing), a capped
 * `{symbol, file, caller_count}` row per changed symbol, and a capped,
 * deduplicated flat list of `{label, kind}` endpoint/cron chips gathered
 * across every symbol. The symbol order is the SERVER's, not this file's:
 * `server/src/modules/blast/helpers.ts` sorts `symbols[]` by `caller_count`
 * desc, then `chips.length` desc, then `name` asc before this projection
 * ever sees it, so the cap below keeps the most useful rows without
 * re-deriving that order here.
 *
 * DROPPED, and why:
 *   - per-caller `file:line` rows — REQ-3's full caller list is a UI
 *     drill-down, not something a model needs to answer "what does this
 *     touch"; `caller_count` already answers "how many".
 *   - `rank` — an internal ordering signal for the caller list this
 *     projection no longer carries.
 *   - `file_impact[]` — the depth<=2 reverse-import walk (REQ-9). Bound A1
 *     already confines it to the Tree's count strip and the client's Graph
 *     view; a flat list of files with no symbol attached would cost tokens
 *     without answering "what does this touch" any better than `totals`
 *     already does.
 *   - `prior_prs[]` — a UI-only accordion (REQ-15); a model asking "what
 *     does this touch" is not asking "what other PRs touched these files".
 *   - `narrative` — the LLM narration (D3) is prose for a human reading a
 *     card; a model already has direct access to `totals`/`symbols`/`chips`,
 *     which is strictly more information than a paragraph summarizing them.
 *   - `coverage`'s per-flag booleans and `changed_file_count` — `status` +
 *     `status_reason` already say in words what could not be determined
 *     (REQ-7); the coverage flags exist for the client's per-section banners,
 *     which a flat tool response has no room to render anyway.
 *
 * `chips` is never attributable back to the symbol or file_impact entry it
 * came from — flattening across symbols is what dedup needs, and the
 * resulting label ("GET /repos/:id" or the raw cron text) is already
 * self-describing without that attribution.
 */

function toSymbolSummary(
  symbol: BlastRadiusResponse['symbols'][number],
): BlastSymbolSummaryShape {
  return { symbol: symbol.name, file: symbol.file, caller_count: symbol.caller_count };
}

/** Flattens every symbol's `chips[]` into one list, deduplicated by
 *  `kind:label` (the same chip — e.g. the same cron literal — legitimately
 *  reappears on more than one symbol's `chips[]` when several changed
 *  symbols sit in the same file). Capped at `MAX_BLAST_CHIPS`, first-seen
 *  order. */
function collectChips(response: BlastRadiusResponse): {
  chips: BlastChipSummaryShape[];
  droppedAny: boolean;
} {
  const seen = new Set<string>();
  const chips: BlastChipSummaryShape[] = [];
  let droppedAny = false;

  for (const symbol of response.symbols) {
    for (const chip of symbol.chips) {
      const key = `${chip.kind}:${chip.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (chips.length >= MAX_BLAST_CHIPS) {
        droppedAny = true;
        continue;
      }
      chips.push({ label: chip.label, kind: chip.kind });
    }
  }

  return { chips, droppedAny };
}

/**
 * Projects a full `BlastRadiusResponse` (fetched over `ApiPort.getBlastRadius`)
 * into `get_blast_radius`'s narrow output shape. Pure — no I/O, no port, no
 * SDK — the same discipline `shaping/project.ts` follows.
 */
export function projectBlastRadius(response: BlastRadiusResponse): GetBlastRadiusOutputResult {
  // `response.symbols` already arrives ordered by usefulness (see the
  // module doc comment above) — this is a plain capped slice, not a sort.
  const symbols = response.symbols.slice(0, MAX_BLAST_SYMBOLS).map(toSymbolSummary);
  const symbolsDropped = response.symbols.length > symbols.length;

  const { chips, droppedAny: chipsDropped } = collectChips(response);

  return {
    status: response.status,
    status_reason: response.status_reason,
    totals: response.totals,
    symbols,
    chips,
    truncated: symbolsDropped || chipsDropped,
  };
}

/** The `text` half of the tool result — one or two sentences, never a
 *  restatement of the structured content (the model already has that). */
export function summarizeBlastRadius(projection: GetBlastRadiusOutputResult): string {
  const totals = projection.totals;
  const parts = [
    totals
      ? `Blast radius: ${totals.symbols} symbol(s), ${totals.callers} caller(s), ` +
        `${totals.endpoints} endpoint(s), ${totals.crons} cron(s) — endpoint/cron detection is ` +
        'heuristic, not certainty.'
      : 'Blast radius: no data.',
  ];
  if (projection.status && projection.status !== 'ok') {
    parts.push(`Status: ${projection.status} — ${projection.status_reason ?? 'no reason given'}.`);
  }
  if (projection.truncated) {
    parts.push('Some symbols or chips were capped out of this response.');
  }
  return parts.join(' ');
}
