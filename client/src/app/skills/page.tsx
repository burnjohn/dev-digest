/* Route: /skills — the Skills Lab library. Rail on the left; the right pane
   prompts for a selection until a skill is opened at /skills/:id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { useSkills } from "../../lib/hooks/skills";
import { SkillsRail } from "./_components/SkillsRail";
import { s } from "./styles";

export default function SkillsPage() {
  const t = useTranslations("skills");
  const { data: skills, isLoading } = useSkills();
  const empty = !isLoading && (skills?.length ?? 0) === 0;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.layout}>
        <SkillsRail />
        <div style={s.detail}>
          <div style={s.selectPrompt}>
            {empty ? (
              <EmptyState icon="Sparkles" title={t("page.empty.title")} body={t("page.empty.body")} />
            ) : (
              <div>
                <Icon.Sparkles size={28} style={{ color: "var(--text-muted)" }} />
                <h2 style={{ ...s.sectionTitle, marginTop: 12 }}>{t("page.selectPrompt.title")}</h2>
                <p style={s.previewSubtitle}>{t("page.selectPrompt.body")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
