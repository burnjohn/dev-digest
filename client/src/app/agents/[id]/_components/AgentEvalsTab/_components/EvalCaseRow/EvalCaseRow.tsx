"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { STATUS_MAP } from "../../constants";
import { caseStatus } from "../../helpers";
import { s } from "./styles";

export type EvalCaseWithLast = EvalCase & {
  last_run?: { pass: boolean | null; recall: number | null } | null;
};

export function EvalCaseRow({
  ec,
  onOpen,
  onRun,
  onDelete,
  running,
}: {
  ec: EvalCaseWithLast;
  onOpen: () => void;
  onRun: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const t = useTranslations("eval");
  const [h, setH] = React.useState(false);
  const status = caseStatus(ec.last_run);
  const map = STATUS_MAP[status];
  const label =
    status === "pass" ? t("evalsTab.passed") : status === "fail" ? t("evalsTab.failed") : t("evalsTab.neverRun");

  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={s.row(h)}>
      {React.createElement(Icon[map.icon], { size: 15, style: s.icon(map.color) })}
      <div style={s.body} onClick={onOpen}>
        <div className="mono" style={s.name}>
          {ec.name}
        </div>
        <div style={s.meta}>
          {label}
          {ec.last_run?.recall != null
            ? t("evalsTab.recallSuffix", { recall: Math.round(ec.last_run.recall * 100) })
            : ""}
        </div>
      </div>
      <Badge color="var(--text-muted)">{ec.owner_kind}</Badge>
      <div style={s.actions(h)}>
        <IconBtn icon="Play" label={running ? t("evalsTab.running") : t("evalsTab.run")} size={26} onClick={onRun} />
        <IconBtn icon="Edit" label={t("evalsTab.edit")} size={26} onClick={onOpen} />
        <IconBtn icon="Trash" label={t("evalsTab.delete")} size={26} danger onClick={onDelete} />
      </div>
    </div>
  );
}

export default EvalCaseRow;
