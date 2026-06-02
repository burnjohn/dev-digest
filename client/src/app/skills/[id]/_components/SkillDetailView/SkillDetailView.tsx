/* Skill detail (A1) — full-page preview/editor for a single skill, deep-linked
   at /skills/:id. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton, MonoLink } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { useSkill } from "../../../../../lib/hooks/skills";
import { SkillPreview } from "../../../_components/SkillPreview";
import { s } from "./styles";

export function SkillDetailView() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const { data: skill, isLoading, isError, refetch } = useSkill(params.id);

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbLab") },
        { label: t("page.crumbSkills"), href: "/skills" },
        { label: skill?.name ?? t("detail.crumbSkill"), mono: true },
      ]}
    >
      <div style={s.backBar}>
        <Link href="/skills">
          <MonoLink>{t("detail.back")}</MonoLink>
        </Link>
      </div>
      <div style={s.layout}>
        {isLoading && (
          <div style={s.loading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={300} />
          </div>
        )}
        {isError && <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} fullScreen />}
        {!isLoading && !isError && !skill && (
          <div style={s.emptyPane}>
            <EmptyState icon="Sparkles" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
          </div>
        )}
        {skill && <SkillPreview skill={skill} />}
      </div>
    </AppShell>
  );
}
