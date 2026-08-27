import type { RiskBriefSources } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { SCALAR_SOURCE_KEYS } from "./constants";

/**
 * `githubBlobUrl(repoFullName, headSha, file)` with NO line arguments — REQ-13
 * forbids a line number anywhere in the brief, and `risks[]` never carries one
 * on the wire (`RiskBriefArea`). Same guard as `BlastCard`'s caller links and
 * `ReviewFocusCard/helpers.ts` `reviewFocusHref`: never build a URL from a
 * `fullName` that falls back to a uuid or from a missing `headSha`
 * (client/INSIGHTS.md 2026-08-17) — the caller renders plain text instead.
 *
 * Deliberately not imported from `ReviewFocusCard/helpers.ts`: a colocated
 * `_components/<Name>/helpers.ts` is that component's own, and reaching across
 * for one would be a promotion decision (`frontend-ui-architecture`) taken for
 * three lines that wrap a function both files already import.
 */
export function riskFileHref(
  repoFullName: string | null | undefined,
  headSha: string | null | undefined,
  file: string,
): string | undefined {
  return repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, file) : undefined;
}

export type MissingSourceKey = (typeof SCALAR_SOURCE_KEYS)[number] | "md_files";

/**
 * Pure function of `sources` — REQ-32/REQ-40/REQ-43/AC-32/AC-40/AC-43.
 *
 * Each of the five SCALAR fields contributes its own key iff it is exactly
 * `"unavailable"` — `partial`, `truncated`, `skipped` and `missing` all
 * contribute nothing (REQ-32, AC-32). `md_files` is an array with no status
 * of its own: it contributes the single key `"md_files"` when ANY entry is
 * `"unavailable"`, exactly once however many entries qualify, and never a
 * path (REQ-40, AC-40). The caller composes ONE sentence from the result
 * (`joinSourceNames`), which is what makes REQ-43/AC-43 hold: one
 * unavailable source and four differ only in the returned array's length,
 * never in how many notes get rendered — there is always at most one.
 */
export function missingSourceKeys(sources: RiskBriefSources): MissingSourceKey[] {
  const keys: MissingSourceKey[] = SCALAR_SOURCE_KEYS.filter((key) => sources[key] === "unavailable");
  if (sources.md_files.some((f) => f.status === "unavailable")) {
    keys.push("md_files");
  }
  return keys;
}

/**
 * Joins already-translated source names into one English list —
 * `"a"` / `"a and b"` / `"a, b and c"` — using T5's `separator` /
 * `lastSeparator` values (`riskBrief.json` `builtWithout.{separator,lastSeparator}`)
 * so the composed sentence never diverges from the shipped copy.
 */
export function joinSourceNames(names: string[], separator: string, lastSeparator: string): string {
  return names.reduce((acc, name, i) => {
    if (i === 0) return name;
    if (i === names.length - 1) return `${acc}${lastSeparator}${name}`;
    return `${acc}${separator}${name}`;
  }, "");
}
