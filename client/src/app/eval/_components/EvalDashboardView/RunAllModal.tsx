"use client";

import { useTranslations } from "next-intl";
import { Modal, Button, Icon } from "@devdigest/ui";
import type { EvalAgentSummary, EvalRunAllResult, EvalSkillSummary } from "@devdigest/shared/contracts/eval-ci";
import { useRunAllEvals, useRunAllSkillEvals, type EvalSkillRunAllResult } from "@/lib/hooks/eval";
import { s } from "./styles";

/**
 * AC-25/AC-42 (agents) and AC-26 (skills) — states the total execution count
 * BEFORE anything runs, and `confirm: true` only goes out once the user
 * clicks the confirm button here (the server 422s either route without it —
 * this dialog IS the confirmation, not a client-side nicety). Reports
 * per-owner progress/failure, never one combined verdict.
 *
 * specs/15-skill-eval-cases.md plan §12 — widened with a `kind` prop rather
 * than forked into a second file: the skills arm states the 2×N executions
 * count (D3's ablation cost) and R5's auto-carrier-selection note, which the
 * agent arm has no equivalent of.
 */
export function RunAllModal({
  kind,
  agents,
  skills,
  onClose,
}: {
  kind: "agents" | "skills";
  agents?: EvalAgentSummary[];
  skills?: EvalSkillSummary[];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const runAllAgents = useRunAllEvals();
  const runAllSkills = useRunAllSkillEvals();

  if (kind === "skills") {
    const relevant = (skills ?? []).filter((sk) => sk.cases_total > 0);
    const executionsTotal = relevant.reduce((sum, sk) => sum + sk.cases_total * 2, 0);
    const result: EvalSkillRunAllResult | undefined = runAllSkills.data;

    return (
      <Modal title={t("skill.run.confirmAllTitle")} onClose={onClose} width={520}>
        <div style={s.modalBody}>
          {!result ? (
            <>
              <p>
                {t("skill.run.confirmAllBody", { skills: relevant.length, executions: executionsTotal })}
              </p>
              <p style={s.note}>{t("skill.run.autoCarrierNote")}</p>
            </>
          ) : (
            <div style={s.section}>
              {result.started.map((row) => (
                <div key={row.skill_id} style={s.resultRow}>
                  {row.run_id ? (
                    <span style={s.outcome("var(--ok, var(--text-secondary))")}>
                      <Icon.CheckCircle size={13} />
                      {row.skill_name} — {t("dashboard.started")}
                    </span>
                  ) : (
                    <span style={s.outcome("var(--crit)")}>
                      <Icon.XCircle size={13} />
                      {row.skill_name} — {row.refused_reason ?? t("dashboard.refused")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose}>
              {t("run.confirmAll.cancel")}
            </Button>
            {!result && (
              <Button kind="primary" loading={runAllSkills.isPending} onClick={() => runAllSkills.mutate()}>
                {t("run.confirmAll.confirm")}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const relevant = (agents ?? []).filter((a) => a.cases_total > 0);
  const executionsTotal = relevant.reduce((sum, a) => sum + a.cases_total, 0);
  const result: EvalRunAllResult | undefined = runAllAgents.data;

  return (
    <Modal title={t("run.confirmAll.title")} onClose={onClose} width={520}>
      <div style={s.modalBody}>
        {!result ? (
          <p>{t("run.confirmAll.body", { agents: relevant.length, executions: executionsTotal })}</p>
        ) : (
          <div style={s.section}>
            {result.started.map((row) => (
              <div key={row.agent_id} style={s.resultRow}>
                {row.run_id ? (
                  <span style={s.outcome("var(--ok, var(--text-secondary))")}>
                    <Icon.CheckCircle size={13} />
                    {row.agent_name} — {t("dashboard.started")}
                  </span>
                ) : (
                  <span style={s.outcome("var(--crit)")}>
                    <Icon.XCircle size={13} />
                    {row.agent_name} — {row.refused_reason ?? t("dashboard.refused")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("run.confirmAll.cancel")}
          </Button>
          {!result && (
            <Button kind="primary" loading={runAllAgents.isPending} onClick={() => runAllAgents.mutate()}>
              {t("run.confirmAll.confirm")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
