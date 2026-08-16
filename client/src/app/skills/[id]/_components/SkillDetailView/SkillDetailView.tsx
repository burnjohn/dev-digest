/* SkillDetailView — the /skills/:id screen: list rail on the left, header +
   tabbed editor on the right. Holds the tab state in ?tab= so a reload and a
   shared link land on the same tab. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { ApiError } from "../../../../../lib/api";
import { useSkill, useSkills, useUpdateSkill } from "../../../../../lib/hooks/skills";
import { SkillCard } from "../../../_components/SkillCard";
import { SkillEditor } from "../SkillEditor";
import { TYPE_COLOR } from "../../../_components/SkillCard/constants";
import { VALID_TABS } from "../SkillEditor/constants";
import { s } from "./styles";

const DEFAULT_TAB = "config";

export function SkillDetailView() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();

  const requested = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(requested) ? requested : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.loadError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  // used_by only exists on the list payload; the single-skill GET returns a bare
  // Skill. Read it off the already-cached list rather than adding a request.
  const usedBy = (skills ?? []).find((x) => x.id === id)?.used_by ?? 0;

  return (
    <AppShell crumb={crumb}>
      <div style={s.split}>
        <aside style={s.rail} aria-label={t("page.heading")}>
          <div style={s.railHeader}>
            <h1 style={s.railTitle}>{t("page.heading")}</h1>
            <Button
              kind="secondary"
              size="sm"
              icon="ChevronLeft"
              onClick={() => router.push("/skills")}
            >
              {t("page.crumbSkills")}
            </Button>
          </div>
          <div style={s.railList}>
            {(skills ?? []).map((x) => (
              <SkillCard
                key={x.id}
                skill={x}
                active={x.id === id}
                href={`/skills/${x.id}?tab=${tab}`}
                onToggle={(enabled) => update.mutate({ id: x.id, patch: { enabled } })}
              />
            ))}
          </div>
        </aside>

        {isLoading || !skill ? (
          <div style={s.loading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={220} />
          </div>
        ) : (
          <div style={s.main}>
            <div style={s.header}>
              <Icon.Sparkles size={18} style={s.headerIcon} />
              <h2 className="mono" style={s.headerName}>
                {skill.name}
              </h2>
              <Badge color={TYPE_COLOR[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
              <Badge color="var(--text-muted)" mono>
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && (
                <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>
              )}
            </div>
            <div style={s.editor}>
              <SkillEditor skill={skill} usedBy={usedBy} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
