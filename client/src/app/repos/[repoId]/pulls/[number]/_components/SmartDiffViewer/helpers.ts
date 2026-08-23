/* Pure helpers for SmartDiffViewer: the annotation adapter that joins Smart
   Diff findings onto rendered diff lines, plus the small lookups the
   component needs to compose the shared diff-viewer primitives.

   Nothing here talks to the network or holds state — every function takes
   the current SmartDiff payload and returns something derived from it, so a
   caller that recomputes on every render (never useState+useEffect) can
   never serve a stale finding id after a re-run (plan §5.7). */
import type { PrFile, Severity, SmartDiff, SmartDiffFile, SmartDiffFileFinding, SmartDiffRole } from "@devdigest/shared";
import { parsePatch } from "@/components/diff-viewer/helpers";
import type { DiffAnnotationApi, DiffLineAnnotation } from "@/components/diff-viewer";

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** T4's message key for a severity's short label ("blocker"/"warning"/"suggestion"). */
export function severityMessageKey(severity: Severity): "severityCritical" | "severityWarning" | "severitySuggestion" {
  if (severity === "CRITICAL") return "severityCritical";
  if (severity === "WARNING") return "severityWarning";
  return "severitySuggestion";
}

/** Static per-role presentation: bullet colour + T4's title/subtitle keys.
 *  Order of iteration is NEVER derived from this map — it is read off
 *  `SmartDiff.groups`, which the server guarantees is always core, wiring,
 *  boilerplate (REQ-1). */
export const ROLE_META: Record<SmartDiffRole, { color: string; titleKey: string; subtitleKey: string }> = {
  core: { color: "var(--accent)", titleKey: "groupTitleCore", subtitleKey: "groupSubtitleCore" },
  wiring: { color: "var(--warn)", titleKey: "groupTitleWiring", subtitleKey: "groupSubtitleWiring" },
  boilerplate: { color: "var(--text-muted)", titleKey: "groupTitleBoilerplate", subtitleKey: "groupSubtitleBoilerplate" },
};

/** The finding to feature when several collapse into one annotation: used
 *  ONLY by `headerFor` (REQ-29), which still shows a single representative
 *  on a collapsed file's header. `forLine` no longer calls this — REQ-15 was
 *  rewritten to show every finding on a line as its own chip, so there is no
 *  winner to pick there any more. Highest severity wins; ties broken by the
 *  lowest id, the only stable, order-independent tiebreak this wire shape
 *  offers. */
export function pickFeatured(findings: SmartDiffFileFinding[]): SmartDiffFileFinding {
  return findings.reduce((best, f) => {
    const rank = SEVERITY_RANK[f.severity];
    const bestRank = SEVERITY_RANK[best.severity];
    if (rank > bestRank) return f;
    if (rank === bestRank && f.id < best.id) return f;
    return best;
  });
}

/** Total order for rendering several chips on one line: severity descending,
 *  then `id` ascending. A comparator that can tie lets chips swap places
 *  between two identical renders — the same discipline as REQ-9's ordering,
 *  and the same class of bug already logged in `server/INSIGHTS.md`
 *  (2026-08-17). `id` is a string, so the tiebreak is a plain `<`/`>`. */
function compareAnnotationOrder(a: SmartDiffFileFinding, b: SmartDiffFileFinding): number {
  const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (rankDiff !== 0) return rankDiff;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** `SmartDiffFile` -> the `PrFile` shape `FileCard` already renders. Patch
 *  text lives only in the PR's own file list (`has_patch` is a flag, not the
 *  text), so it is looked up by path from the caller's `PrFile[]`. */
export function toPrFile(file: SmartDiffFile, patchByPath: Map<string, string | null | undefined>): PrFile {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.has_patch ? (patchByPath.get(file.path) ?? null) : null,
  };
}

interface AnnotationApiParams {
  response: SmartDiff;
  patchByPath: Map<string, string | null | undefined>;
  onOpenFinding: (id: string) => void;
  severityLabel: (severity: Severity) => string;
  chipTitle: (severity: Severity, count: number) => string;
  orphanTitle: () => string;
}

/** Builds the `DiffAnnotationApi` the shared `FileCard`/`CodeLine` primitives
 *  render through. Rebuilt fresh from `response` on every call — the caller
 *  must NOT memoize this on anything but the payload itself (§5.7 — a stale
 *  closure over an old finding id reproduces the wrong-card bug even when
 *  the query cache is fresh). */
export function buildAnnotationApi(params: AnnotationApiParams): DiffAnnotationApi {
  const { response, patchByPath, onOpenFinding, severityLabel, chipTitle, orphanTitle } = params;

  const filesByPath = new Map<string, SmartDiffFile>();
  for (const group of response.groups) {
    for (const file of group.files) filesByPath.set(file.path, file);
  }

  const renderedLinesByPath = new Map<string, Set<number>>();
  function renderedLines(path: string): Set<number> {
    let set = renderedLinesByPath.get(path);
    if (!set) {
      const lines = parsePatch(patchByPath.get(path));
      set = new Set(lines.map((ln) => ln.newNo).filter((n): n is number => n != null));
      renderedLinesByPath.set(path, set);
    }
    return set;
  }

  function annotationFor(f: SmartDiffFileFinding, key: string, count: number): DiffLineAnnotation {
    return {
      key,
      severity: f.severity,
      label: severityLabel(f.severity),
      count: count > 1 ? count : undefined,
      title: chipTitle(f.severity, count),
      onClick: () => onOpenFinding(f.id),
    };
  }

  return {
    forLine(path, newNo) {
      const file = filesByPath.get(path);
      if (!file) return [];
      const onLine = file.findings
        .filter((f) => f.line === newNo && f.line !== 0)
        .sort(compareAnnotationOrder);
      // REQ-15 (rewritten): one chip per finding, never an aggregated ×N —
      // `count` is 1 for every entry so `annotationFor` never sets it.
      return onLine.map((f) => annotationFor(f, `${path}:${newNo}:${f.id}`, 1));
    },
    orphansFor(path) {
      const file = filesByPath.get(path);
      if (!file || file.findings.length === 0) return [];
      const visible = renderedLines(path);
      const orphaned = file.findings.filter((f) => f.line === 0 || !visible.has(f.line));
      return orphaned.map((f) => ({
        key: f.id,
        severity: f.severity,
        label: severityLabel(f.severity),
        count: undefined,
        title: orphanTitle(),
        onClick: () => onOpenFinding(f.id),
      }));
    },
    headerFor(path) {
      const file = filesByPath.get(path);
      if (!file || file.findings.length === 0) return null;
      const featured = pickFeatured(file.findings);
      return annotationFor(featured, `${path}:header`, file.findings.length);
    },
  };
}
