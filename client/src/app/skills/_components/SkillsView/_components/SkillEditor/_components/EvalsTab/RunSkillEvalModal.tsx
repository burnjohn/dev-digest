"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { EvalSkillCarrier } from "@devdigest/shared/contracts/eval-ci";
import { useSkillEvalEstimate, useStartSkillEvalRun } from "@/lib/hooks/eval";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { CarrierPicker } from "./CarrierPicker";
import { s } from "./styles";

/**
 * AC-11, AC-25, AC-49 — carrier selection, the "N cases → 2N executions"
 * statement, and the unvetted-body (gates-bypassed) warning, all rendered
 * BEFORE the confirm button ever posts. AC-48: keyboard-operable, and
 * `onStarted` hands the new run id up so the tab can announce its status.
 */
export function RunSkillEvalModal({
  skill,
  carriers,
  onClose,
  onStarted,
}: {
  skill: Skill;
  carriers: EvalSkillCarrier[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const [carrierId, setCarrierId] = React.useState<string | null>(carriers[0]?.agent_id ?? null);
  const { data: estimate } = useSkillEvalEstimate(skill.id, carrierId);
  const startRun = useStartSkillEvalRun();

  const selectedCarrier = carriers.find((c) => c.agent_id === carrierId) ?? null;
  const gatesBypassed = selectedCarrier ? !(selectedCarrier.skill_enabled && selectedCarrier.link_enabled) : false;

  const confirm = () => {
    if (!carrierId) return;
    startRun.mutate(
      { skillId: skill.id, carrierAgentId: carrierId },
      {
        onSuccess: (result) => {
          onStarted(result.run_id);
          onClose();
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : t("run.refused.generic"));
        },
      },
    );
  };

  return (
    <Modal title={t("skill.run.title")} onClose={onClose} width={480}>
      <div style={s.modalBody}>
        <CarrierPicker carriers={carriers} value={carrierId} onChange={setCarrierId} />

        {estimate && (
          <p style={s.hint}>
            {t("skill.run.estimate", { cases: estimate.cases_total, executions: estimate.executions_total })}
          </p>
        )}

        {gatesBypassed && (
          <p style={s.notice}>
            <Icon.AlertTriangle size={13} />
            {t("skill.run.gatesBypassedWarning")}
          </p>
        )}

        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("run.confirmAll.cancel")}
          </Button>
          <Button kind="primary" disabled={!carrierId} loading={startRun.isPending} onClick={confirm}>
            {t("skill.run.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
