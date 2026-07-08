"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, type IconName } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import { evalStyles as s } from "@/components/eval";

/** Status → icon + color, 5 distinct visual states (AC-26/AC-27). */
const STATUS_META: Record<EvalCaseListItem["last_run_status"], { icon: IconName; color: string }> = {
  never_run: { icon: "Dot", color: "var(--text-muted)" },
  passed: { icon: "CheckCircle", color: "var(--ok)" },
  failed: { icon: "XCircle", color: "var(--crit)" },
  error: { icon: "AlertOctagon", color: "var(--crit)" },
  flaked: { icon: "AlertTriangle", color: "var(--warn)" },
};

interface CaseRowProps {
  evalCase: EvalCaseListItem;
  statusLabel: string;
  subtitle: string | null;
  runLabel: string;
  editLabel: string;
  deleteLabel: string;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isRunning: boolean;
  /** True whenever any batch run (this case, another case, or run-all) is in
      flight — disables Run so overlapping batches can't be triggered (S4). */
  runDisabled?: boolean;
}

export function CaseRow({
  evalCase,
  statusLabel,
  subtitle,
  runLabel,
  editLabel,
  deleteLabel,
  onRun,
  onEdit,
  onDelete,
  isRunning,
  runDisabled,
}: CaseRowProps) {
  const t = useTranslations("agents");
  const meta = STATUS_META[evalCase.last_run_status];
  const StatusIcon = Icon[meta.icon];

  // Row badge + right-side chip derive from the expectations (display metadata
  // only — never scored). Prefer a must_find for the badge/chip; a
  // must_not_flag-only case reads "assert empty".
  const exps = evalCase.expected_output;
  const primary = exps.find((e) => e.type === "must_find") ?? exps[0];
  const typeLabel = primary ? t(`evals.expectation.${primary.type}`).toUpperCase() : null;
  const typeColor = primary?.type === "must_find" ? "var(--accent)" : "var(--text-muted)";
  const metaChip = !primary
    ? null
    : primary.type === "must_not_flag"
      ? t("evals.expectation.assertEmpty")
      : [primary.severity, primary.category].filter(Boolean).join(" · ") || null;

  return (
    <div style={s.row} data-testid={`eval-case-row-${evalCase.id}`}>
      <StatusIcon size={16} style={{ color: meta.color, flexShrink: 0 }} aria-label={statusLabel} />
      <div style={s.rowMain}>
        <div style={{ ...s.rowName, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{evalCase.name}</span>
          {typeLabel && <Badge color={typeColor}>{typeLabel}</Badge>}
        </div>
        {subtitle && <div style={s.rowSubtitle}>{subtitle}</div>}
      </div>
      {metaChip && <span style={s.metaChip}>{metaChip}</span>}
      <div style={s.rowActions}>
        <button type="button" style={s.iconAction} title={runLabel} aria-label={runLabel} onClick={onRun} disabled={isRunning || runDisabled}>
          <Icon.Play size={14} />
        </button>
        <button type="button" style={s.iconAction} title={editLabel} aria-label={editLabel} onClick={onEdit}>
          <Icon.Edit size={14} />
        </button>
        <button type="button" style={s.iconAction} title={deleteLabel} aria-label={deleteLabel} onClick={onDelete}>
          <Icon.Trash size={14} />
        </button>
      </div>
    </div>
  );
}
