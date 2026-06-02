"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle, Chip, FormField, SelectInput, Checkbox } from "@devdigest/ui";
import { useSettings, useUpdateSettings } from "../../../../../../../lib/hooks";
import { SectionTitle } from "../SectionTitle";
import { DEFAULT_POLLING_INTERVAL_MIN, INTERVAL_OPTIONS } from "./constants";
import { s } from "./styles";

export function SettingsAutoReviews() {
  const t = useTranslations("settings");
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const on = settings?.automatic_reviews ?? false;
  const interval = settings?.polling_interval_min ?? DEFAULT_POLLING_INTERVAL_MIN;
  const [conds, setConds] = React.useState<[boolean, boolean]>([true, true]);
  return (
    <div style={s.wrap}>
      <SectionTitle title={t("autoReviews.title")} body={t("autoReviews.body")} />
      <div style={s.toggleCard}>
        <Toggle on={on} onChange={(v) => update.mutate({ automatic_reviews: v })} size={18} />
        <div>
          <div style={s.toggleTitle}>{t("autoReviews.toggleTitle")}</div>
          <div style={s.toggleSub}>{on ? t("autoReviews.active") : t("autoReviews.off")}</div>
        </div>
      </div>
      <FormField label={t("autoReviews.pollingInterval")}>
        <SelectInput
          value={String(interval)}
          onChange={(v) => update.mutate({ polling_interval_min: Number(v) })}
          options={INTERVAL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        />
      </FormField>
      <FormField label={t("autoReviews.agentsToRun")}>
        <div style={s.chips}>
          <Chip active icon="Check">
            {t("autoReviews.securityReviewer")}
          </Chip>
          <Chip active icon="Check">
            {t("autoReviews.performanceReviewer")}
          </Chip>
          <Chip icon="Plus">{t("autoReviews.customMentor")}</Chip>
        </div>
      </FormField>
      <FormField label={t("autoReviews.triggerConditions")}>
        <div style={s.conditions}>
          <Checkbox
            checked={conds[0]}
            onChange={(v) => setConds([v, conds[1]])}
            label={t("autoReviews.onNewPr")}
          />
          <Checkbox
            checked={conds[1]}
            onChange={(v) => setConds([conds[0], v])}
            label={t("autoReviews.onNewCommits")}
          />
        </div>
      </FormField>
      <div style={s.note}>
        <Icon.Info size={15} style={s.noteIcon} />
        <span>
          {t.rich("autoReviews.pollingNote", {
            b: (chunks) => <b style={s.noteStrong}>{chunks}</b>,
          })}
        </span>
      </div>
    </div>
  );
}
