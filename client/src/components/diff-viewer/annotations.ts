/* Optional "annotations" feature slot for the DiffViewer — threads Smart Diff
   findings onto rendered lines exactly the way `commenting` (see comments.ts)
   threads inline PR comments: a plain pass-through prop, DiffViewer → FileCard
   → CodeLine, absent by default and inert when absent.

   This primitive is shared and owns NO wording: `label` and `title` are always
   caller-supplied strings (the caller reads them from prReview's `smartDiff`
   message keys). Never hardcode a literal like "blocker" in this module or in
   DiffViewer/FileCard/CodeLine — see the T3 red flags in docs/plans/04-smart-diff.md. */
import type { Severity } from "@devdigest/shared";

/**
 * One rendered annotation: an on-line chip, an orphan-findings entry, or a
 * file-header indicator. `count` is the number of distinct findings collapsed
 * into this one annotation. An on-line chip (`forLine`) always represents
 * exactly one finding and never sets `count` (REQ-15 rewritten — several
 * findings on one line render as that many separate chips, each linking to
 * its own finding). The collapsed single-representative shape survives only
 * on the file-header indicator (`headerFor`, REQ-29), where `count` still
 * carries the highest severity present plus how many findings it stands for.
 */
export interface DiffLineAnnotation {
  /** Stable React key for the caller's rendered list — NOT necessarily a
   *  finding id (a header/orphan annotation can represent several findings
   *  at once; an on-line chip's key still encodes its own finding). */
  key: string;
  severity: Severity;
  /** Caller-supplied short text shown in the chip, e.g. "blocker". */
  label: string;
  /** Present and > 1 when several findings collapsed into this one chip. */
  count?: number;
  /** Full accessible name — used as `aria-label` and `title` on the control. */
  title: string;
  onClick: () => void;
}

/**
 * What DiffViewer needs to read Smart Diff findings. All three members are
 * pure lookups the caller re-derives from fresh data on every render — this
 * primitive never memoizes an annotation by finding id internally. A finding
 * id is run-scoped (§5.7 of the plan): caching one across a re-run is exactly
 * how a stale, wrong-card link survives.
 */
export interface DiffAnnotationApi {
  /** All on-line chips for `path` at new-file line `newNo` — one per finding
   *  anchored to that line, or an empty array when the line carries none
   *  (REQ-14, REQ-15 rewritten). Ordered severity descending then `id`
   *  ascending, a total order so the row is stable between identical
   *  renders. Only called for lines that have a `newNo` (add/ctx) — a
   *  deleted line has none. */
  forLine(path: string, newNo: number): DiffLineAnnotation[];
  /** Findings for `path` that could not be anchored to any rendered line —
   *  truncated context, an outdated line, or a null patch (REQ-16). */
  orphansFor(path: string): DiffLineAnnotation[];
  /** The collapsed-state indicator for `path`, rendered in the file header
   *  whether the card is open or closed (REQ-29). Returns null when the file
   *  carries no findings. */
  headerFor(path: string): DiffLineAnnotation | null;
}
