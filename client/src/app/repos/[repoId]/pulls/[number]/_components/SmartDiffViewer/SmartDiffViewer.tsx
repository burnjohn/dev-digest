/* SmartDiffViewer — Smart Diff (A2): groups changed files into
   core/wiring/boilerplate, shows finding-line markers per file, and a split
   nudge banner when the PR is too big (§7). Falls back to the basic DiffViewer
   for the raw patch of each file. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button } from "@devdigest/ui";
import type { SmartDiff, PrFile } from "@devdigest/shared";
import { DiffViewer } from "../../../../../../../components/diff-viewer";
import { ROLE_META } from "./constants";
import { indexByPath, resolveGroupFiles, totalFindingLines } from "./helpers";
import { s } from "./styles";

export function SmartDiffViewer({
  smartDiff,
  files,
}: {
  smartDiff: SmartDiff;
  files: PrFile[];
}) {
  const t = useTranslations("prReview");
  const byPath = React.useMemo(() => indexByPath(files), [files]);

  const { too_big, total_lines, proposed_splits } = smartDiff.split_suggestion;

  return (
    <div style={s.root}>
      {too_big && (
        <div style={s.nudge}>
          <Icon.Slash size={18} style={s.nudgeIcon} />
          <div style={s.nudgeBody}>
            <div style={s.nudgeTitle}>{t("smartDiff.largeTitle", { lines: total_lines })}</div>
            <p style={s.nudgeText}>{t("smartDiff.largeBody")}</p>
            <div style={s.splitList}>
              {proposed_splits.map((split, i) => (
                <div key={i} style={s.splitRow}>
                  <Icon.CornerDownRight size={13} style={s.splitIcon} />
                  <span style={s.splitName}>{split.name}</span>
                  <Badge color="var(--text-muted)">
                    {t("smartDiff.filesCount", { count: split.files.length })}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {smartDiff.groups.map((group) => {
        const meta = ROLE_META[group.role];
        const GroupIcon = Icon[meta.icon];
        const groupFiles = resolveGroupFiles(group.files, byPath);
        return (
          <section key={group.role}>
            <div style={s.groupHeader}>
              <GroupIcon size={14} style={{ color: meta.color }} />
              <span style={s.groupLabel(meta.color)}>{t(`smartDiff.${meta.labelKey}`)}</span>
              <Badge color="var(--text-muted)">{group.files.length}</Badge>
              {group.files.some((f) => f.finding_lines.length > 0) && (
                <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
                  {t("smartDiff.findingLines", { count: totalFindingLines(group.files) })}
                </Badge>
              )}
            </div>
            {groupFiles.length > 0 ? (
              <DiffViewer files={groupFiles} />
            ) : (
              <div style={s.fileList}>
                {group.files.map((f, i) => (
                  <div key={i} style={s.fileRow}>
                    <Icon.FileText size={13} style={s.fileIcon} />
                    <span className="mono" style={s.filePath}>
                      {f.path}
                    </span>
                    <span className="mono tnum" style={s.fileStat}>
                      <span style={s.addCount}>+{f.additions}</span>{" "}
                      <span style={s.delCount}>−{f.deletions}</span>
                    </span>
                    {f.finding_lines.length > 0 && (
                      <span style={s.fileFlag}>⚑ {f.finding_lines.length}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <div style={s.footer}>
        <Button kind="ghost" size="sm" icon="RefreshCw" disabled>
          {t("smartDiff.groupedByRole")}
        </Button>
      </div>
    </div>
  );
}
