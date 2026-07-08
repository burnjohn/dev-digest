"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, type IconName } from "@devdigest/ui";
import type { SkillEvalCaseListItem } from "@devdigest/shared";
import { s } from "../../styles";

/**
 * Status → icon + color, 5 DISTINCT visual states (AC-30). `failed_grounding`
 * (AlertOctagon/crit) is deliberately a different icon+color pairing from
 * `failed_judge` (XCircle/warn) so an author can tell at a glance which
 * scoring tier failed, without reading the subtitle text.
 */
const STATUS_META: Record<SkillEvalCaseListItem["last_run_status"], { icon: IconName; color: string }> = {
  never_run: { icon: "Dot", color: "var(--text-muted)" },
  passed: { icon: "CheckCircle", color: "var(--ok)" },
  failed_grounding: { icon: "AlertOctagon", color: "var(--crit)" },
  failed_judge: { icon: "XCircle", color: "var(--warn)" },
  error: { icon: "AlertTriangle", color: "var(--text-muted)" },
};

interface SkillCaseRowProps {
  evalCase: SkillEvalCaseListItem;
  isRunning: boolean;
  /** True whenever any batch run (this case, another case, or run-all) is in
      flight — disables Run so overlapping batches can't be triggered. */
  runDisabled?: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function SkillCaseRow({ evalCase, isRunning, runDisabled, onRun, onEdit, onDelete }: SkillCaseRowProps) {
  const t = useTranslations("skills");
  const meta = STATUS_META[evalCase.last_run_status];
  const StatusIcon = Icon[meta.icon];
  const statusLabel = t(`evals.status.${evalCase.last_run_status}`);

  const subtitle =
    evalCase.last_run_status === "never_run" ? t("evals.summary.neverRun") : (evalCase.last_run_summary ?? statusLabel);

  return (
    <div style={s.row} data-testid={`skill-eval-case-row-${evalCase.id}`}>
      <StatusIcon size={16} style={{ color: meta.color, flexShrink: 0 }} aria-label={statusLabel} />
      <div style={s.rowMain}>
        <div style={{ ...s.rowName, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{evalCase.name}</span>
        </div>
        <div style={s.rowSubtitle}>{subtitle}</div>
      </div>
      {evalCase.practices.length > 0 && (
        <Badge color="var(--accent)">{t("evals.case.practicesCount", { count: evalCase.practices.length })}</Badge>
      )}
      {evalCase.grounding.length > 0 && (
        <Badge color="var(--text-muted)">{t("evals.case.groundingCount", { count: evalCase.grounding.length })}</Badge>
      )}
      <div style={s.rowActions}>
        <button
          type="button"
          style={s.iconAction}
          title={t("evals.case.run")}
          aria-label={t("evals.case.run")}
          onClick={onRun}
          disabled={isRunning || runDisabled}
        >
          <Icon.Play size={14} />
        </button>
        <button
          type="button"
          style={s.iconAction}
          title={t("evals.case.edit")}
          aria-label={t("evals.case.edit")}
          onClick={onEdit}
        >
          <Icon.Edit size={14} />
        </button>
        <button
          type="button"
          style={s.iconAction}
          title={t("evals.case.delete")}
          aria-label={t("evals.case.delete")}
          onClick={onDelete}
        >
          <Icon.Trash size={14} />
        </button>
      </div>
    </div>
  );
}
