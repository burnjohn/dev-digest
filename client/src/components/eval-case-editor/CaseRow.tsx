"use client";

import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn } from "@devdigest/ui";
import type { EvalCase, EvalCaseEffect, EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import { s } from "./styles";

/**
 * AC-38 (agent) / AC-35 (skill) — name, expectation type, severity/category
 * tags, expected vs actual finding counts and pass/fail from the latest run,
 * plus run/edit/delete. `outcome` is this case's slice of the latest
 * COMPLETED run's `per_case` array (null when the case has never been
 * covered by a completed run). AC-55/AC-47: pass/fail/errored/effect carries
 * an icon + text label, never colour alone.
 *
 * `origin`/`effect` are additive, optional props (client/LEARNINGS.md
 * 2026-08-21 — gated on presence, not truthiness) — undefined for the
 * agent tab's call site, which renders byte-for-byte as before this
 * widening (specs/15-skill-eval-cases.md plan §11). The skill Evals tab
 * supplies both: `origin` (AC-35's "which finding, or hand-authored") and
 * `effect` (this case's classification from the latest skill-owned run).
 */
export function CaseRow({
  evalCase,
  outcome,
  runDisabled,
  onOpen,
  onRun,
  onDelete,
  origin,
  effect,
}: {
  evalCase: EvalCase;
  outcome: EvalCaseOutcome | null;
  runDisabled: boolean;
  onOpen: () => void;
  onRun: () => void;
  onDelete: () => void;
  origin?: "finding" | "hand";
  effect?: EvalCaseEffect | null;
}) {
  const t = useTranslations("eval");
  const expectation = evalCase.expectation;

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.rowTitleLine}>
          <button type="button" style={s.rowName} onClick={onOpen}>
            {evalCase.name}
          </button>
          <Badge>
            {expectation.type === "must_find" ? t("expectation.mustFind") : t("expectation.mustNotFlag")}
          </Badge>
          {expectation.severity && <Badge color="var(--text-muted)">{expectation.severity}</Badge>}
          {expectation.category && <Badge color="var(--text-muted)">{expectation.category}</Badge>}
          {origin !== undefined && (
            <Badge color="var(--text-muted)">
              {origin === "finding" ? t("skill.origin.finding") : t("skill.origin.hand")}
            </Badge>
          )}
        </div>
        <div style={s.rowMetaLine}>
          <span>
            {outcome
              ? t("evalsTab.matchedCount", { matched: outcome.findings_matched, total: outcome.findings_total })
              : "—"}
          </span>
          <Outcome outcome={outcome} />
          {effect !== undefined && <EffectTag effect={effect} />}
        </div>
      </div>
      <div style={s.rowActions}>
        <IconBtn icon="Play" label={t("evalsTab.run")} onClick={onRun} disabled={runDisabled} />
        <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={onOpen} />
        <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={onDelete} />
      </div>
    </div>
  );
}

function Outcome({ outcome }: { outcome: EvalCaseOutcome | null }) {
  const t = useTranslations("eval");
  if (!outcome) return null;
  if (outcome.status === "errored") {
    return (
      <span style={s.outcome("var(--warn)")}>
        <Icon.AlertTriangle size={12} />
        {t("evalsTab.errored")}
      </span>
    );
  }
  return outcome.pass ? (
    <span style={s.outcome("var(--ok, var(--text-secondary))")}>
      <Icon.CheckCircle size={12} />
      {t("evalsTab.passed")}
    </span>
  ) : (
    <span style={s.outcome("var(--crit)")}>
      <Icon.XCircle size={12} />
      {t("evalsTab.failed")}
    </span>
  );
}

/** D5/AC-20/AC-35 — the case's effect classification in the latest skill run
 *  (`null` when the skill has never been run, distinct from `undefined`
 *  which means "not a skill case at all"). */
function EffectTag({ effect }: { effect: EvalCaseEffect | null }) {
  const t = useTranslations("eval");
  if (effect === null) return <span style={s.outcome("var(--text-muted)")}>{t("skill.effect.none")}</span>;
  if (effect === "helped") {
    return (
      <span style={s.outcome("var(--ok, var(--text-secondary))")}>
        <Icon.TrendingUp size={12} />
        {t("skill.effect.helped")}
      </span>
    );
  }
  if (effect === "hurt") {
    return (
      <span style={s.outcome("var(--crit)")}>
        <Icon.TrendingDown size={12} />
        {t("skill.effect.hurt")}
      </span>
    );
  }
  if (effect === "no_effect_pass") {
    return (
      <span style={s.outcome("var(--text-muted)")}>
        <Icon.CheckCircle size={12} />
        {t("skill.effect.noEffectPass")}
      </span>
    );
  }
  return (
    <span style={s.outcome("var(--text-muted)")}>
      <Icon.XCircle size={12} />
      {t("skill.effect.noEffectFail")}
    </span>
  );
}
