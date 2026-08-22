/* SmartDiffViewer — the reviewer-ordered view of a PR's changed files
   (REQ-1/REQ-3/REQ-5/REQ-14/REQ-15/REQ-16/REQ-20/REQ-28/REQ-29). A
   COMPOSITION over the shared diff-viewer primitives (`FileCard`,
   `parsePatch`, the `DiffAnnotationApi` slot) — never a second viewer. Group
   sections are static headings (REQ-28: no chevron, no group-level open
   state anywhere); what collapses is each file's diff, and that is decided
   entirely on the server (`file.default_open`, REQ-3) — this component never
   re-derives it.

   REQ-27: the mockup's per-file "What this does:" row and `summary` pill are
   NOT built this iteration — `pseudocode_summary` is an unwritten
   placeholder (see docs/plans/04-smart-diff.md §5.8). Neither renders here,
   for any payload, and nothing here calls a model. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Icon } from "@devdigest/ui";
import type { PrFile, PrDiffSource, PrDiffSourceReason, Severity, SmartDiff } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import { buildAnnotationApi, ROLE_META, severityMessageKey, toPrFile } from "./helpers";
import { s, groupBulletStyle } from "./styles";

interface SmartDiffViewerProps {
  response: SmartDiff;
  /** The PR's changed files, read only for their `patch` text — every other
   *  field SmartDiffViewer needs (path, additions, deletions, findings,
   *  default_open, large) already lives on `response`. */
  files: PrFile[];
  diffSource?: PrDiffSource | null;
  diffReason?: PrDiffSourceReason | null;
  /** Called with a finding's id when its chip is clicked (REQ-17). Never
   *  navigates itself — the caller owns the route transition. */
  onOpenFinding: (id: string) => void;
}

export function SmartDiffViewer({ response, files, diffSource, onOpenFinding }: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const tShell = useTranslations("shell");

  // Fresh on every render, derived only from `response`/`files` — never held
  // in state and never memoized on anything but the payload itself (§5.7):
  // a stale closure over an old finding id would reproduce the wrong-card
  // bug on the client even when the query cache is fresh.
  const patchByPath = new Map<string, string | null | undefined>();
  for (const f of files) patchByPath.set(f.path, f.patch);

  const severityLabel = React.useCallback((severity: Severity) => t(`smartDiff.${severityMessageKey(severity)}`), [t]);
  const annotations = buildAnnotationApi({
    response,
    patchByPath,
    onOpenFinding,
    severityLabel,
    chipTitle: (severity, count) => t("smartDiff.chipAriaLabel", { severity: severityLabel(severity), count }),
    orphanTitle: () => t("smartDiff.notOnVisibleLine", { count: 1 }),
  });

  const stale = diffSource != null && diffSource !== "github";
  const isEmpty = response.groups.every((g) => g.files.length === 0);

  return (
    <div style={s.root}>
      <SectionLabel icon="Code">{t("smartDiff.sectionLabel")}</SectionLabel>
      {isEmpty
        ? // REQ-20: a degraded diffSource already explains itself via the
          // notice DiffTab renders above this component — don't also show
          // an empty state that would read as "your PR has zero files".
          !stale && <div style={s.empty}>{tShell("diffViewer.noChangedFiles")}</div>
        : response.groups.map((group) => {
            const meta = ROLE_META[group.role];
            return (
              <div key={group.role} style={s.groupSection}>
                <div style={s.groupHeader}>
                  <span style={groupBulletStyle(meta.color)} />
                  <span style={s.groupTitle}>{t(`smartDiff.${meta.titleKey}`)}</span>
                  <span style={s.groupSubtitle}>{t(`smartDiff.${meta.subtitleKey}`)}</span>
                  <span style={s.groupCount}>{t("list.filesCount", { count: group.file_count })}</span>
                </div>
                <div style={s.fileList}>
                  {group.files.map((file) => (
                    <div key={file.path} style={s.fileWrap}>
                      {file.large && (
                        <span style={s.largeBadge}>
                          <Icon.AlertTriangle size={10} />
                          {t("smartDiff.largeFileBadge")}
                        </span>
                      )}
                      <FileCard file={toPrFile(file, patchByPath)} annotations={annotations} defaultOpen={file.default_open} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
    </div>
  );
}
