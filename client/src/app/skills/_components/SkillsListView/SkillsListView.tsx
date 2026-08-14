/* /skills — the Skills page. A narrow list column on the left, the tabbed
   SkillDetail panel on the right. Both the selected skill and its active tab
   live in the URL (`?skill=&tab=`), the same way the agent editor keeps its
   tab in `?tab=` — so a reload or a browser back lands back where you were. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { SkillDetail } from "../SkillDetail";
import { TAB_KEYS } from "../SkillDetail/constants";
import { AddSkillDrawer, type AddSkillTab } from "../AddSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const urlParams = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();

  const [search, setSearch] = React.useState("");
  const [drawerTab, setDrawerTab] = React.useState<AddSkillTab | null>(null);

  const skillParam = urlParams.get("skill");
  const tabParam = urlParams.get("tab") ?? "";
  const tab = TAB_KEYS.includes(tabParam) ? tabParam : "config";

  const navigate = (next: { skill?: string | null; tab?: string }) => {
    const sp = new URLSearchParams(urlParams.toString());
    if (next.skill !== undefined) {
      if (next.skill === null) sp.delete("skill");
      else sp.set("skill", next.skill);
    }
    if (next.tab !== undefined) sp.set("tab", next.tab);
    router.replace(`/skills?${sp.toString()}`);
  };

  const list = filterSkills(skills ?? [], search);
  // Read the selection out of server state rather than holding the skill
  // object: an edit or a toggle re-renders the detail panel from the query
  // cache for free, and a deleted/missing id resolves to undefined instead of
  // a stale panel.
  const selected = (skills ?? []).find((sk) => sk.id === skillParam);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {drawerTab && (
        <AddSkillDrawer
          initialTab={drawerTab}
          onClose={() => setDrawerTab(null)}
          onCreated={(skill) => navigate({ skill: skill.id, tab: "config" })}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={240}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setDrawerTab("create") },
              { divider: true },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setDrawerTab("file") },
              // URL + community are declared but not wired — the drawer explains
              // why on each tab rather than the menu silently hiding them.
              { label: t("page.menu.fromUrl"), icon: "Globe", muted: true, onClick: () => setDrawerTab("url") },
              {
                label: t("page.menu.community"),
                icon: "Users",
                muted: true,
                onClick: () => setDrawerTab("community"),
              },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.listCol}>
            <div style={s.loadingList}>
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
            </div>
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && (skills ?? []).length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setDrawerTab("create")}
          />
        )}

        {(skills ?? []).length > 0 && (
          <div style={s.split}>
            <div style={s.listCol}>
              {list.length === 0 ? (
                <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />
              ) : (
                list.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    active={skill.id === skillParam}
                    onClick={() => navigate({ skill: skill.id, tab })}
                    onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
                  />
                ))
              )}
            </div>

            <div style={s.detailCol}>
              {selected ? (
                // `key` resets every tab's local edit state when the selection
                // changes. Doing that in an effect instead would paint one
                // stale frame of the previous skill's fields first, and would
                // also clobber an in-progress Config-tab edit on any
                // background refetch.
                <SkillDetail
                  key={selected.id}
                  skill={selected}
                  tab={tab}
                  onTab={(nextTab) => navigate({ tab: nextTab })}
                  onDeleted={() => navigate({ skill: null })}
                />
              ) : (
                <div style={s.selectPlaceholder}>
                  <EmptyState
                    icon="FileText"
                    title={t("page.selectPrompt.title")}
                    body={t("page.selectPrompt.body")}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
