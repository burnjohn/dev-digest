"use client";

import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { EvalSkillCarrier } from "@devdigest/shared/contracts/eval-ci";
import { s } from "./styles";

/**
 * AC-11 — the carrier picker: every agent currently linked to this skill,
 * already `order asc, name asc` (plan §3 — no client-side sort). AC-49 — no
 * linked agent is stated here, before any POST, rather than left to a 422.
 */
export function CarrierPicker({
  carriers,
  value,
  onChange,
}: {
  carriers: EvalSkillCarrier[];
  value: string | null;
  onChange: (agentId: string) => void;
}) {
  const t = useTranslations("eval");

  if (carriers.length === 0) {
    return <p style={s.hint}>{t("skill.run.noCarriers")}</p>;
  }

  return (
    <div style={s.formField}>
      <label style={s.label} htmlFor="skill-eval-carrier">
        {t("skill.run.carrierLabel")}
      </label>
      <SelectInput
        id="skill-eval-carrier"
        value={value ?? ""}
        onChange={onChange}
        options={carriers.map((c) => ({
          value: c.agent_id,
          label:
            c.skill_enabled && c.link_enabled
              ? c.agent_name
              : t("skill.run.carrierBypassOption", { agent: c.agent_name }),
        }))}
      />
    </div>
  );
}
