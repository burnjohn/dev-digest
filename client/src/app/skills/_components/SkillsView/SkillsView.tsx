/* Skills screen — left rail of skill cards + a five-tab editor on the right.
   Same two-pane shape as AgentEditorView. Selection lives in the route
   (/skills vs /skills/:id), tab state in ?tab= — the AgentEditor convention. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useCreateSkill, useSkill, useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { AddSkillMenu } from "./_components/AddSkillMenu";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import { SkillEditor } from "./_components/SkillEditor";
import { SkillRailCard } from "./_components/SkillRailCard";
import { DEFAULT_TAB, NEW_SKILL_BODY, VALID_TABS, type SkillTab } from "./constants";
import { filterSkills, nextSkillName } from "./helpers";
import { s } from "./styles";

export function SkillsView({ selectedId }: { selectedId?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();

  const [query, setQuery] = React.useState("");
  const [importMode, setImportMode] = React.useState<"file" | "url" | null>(null);

  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: skill, isLoading: skillLoading } = useSkill(selectedId);
  const create = useCreateSkill();
  // Same workspace `enabled` gate the Config tab's toggle flips — one cache
  // entry, so a toggle in either place is visible in the other immediately.
  const update = useUpdateSkill();

  const requested = search.get("tab") ?? "";
  const tab = ((VALID_TABS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_TAB) as SkillTab;

  const setTab = (t: string) => {
    if (!selectedId) return;
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${selectedId}?${sp.toString()}`);
  };

  const createAndOpen = () => {
    const name = nextSkillName(skills ?? []);
    create.mutate(
      { name, description: "", type: "custom", body: NEW_SKILL_BODY, enabled: true },
      { onSuccess: (created) => router.push(`/skills/${created.id}?tab=config`) },
    );
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    ...(skill ? [{ label: skill.name }] : []),
  ];

  const filtered = filterSkills(skills ?? [], query);

  return (
    <AppShell crumb={crumb}>
      <div style={s.split}>
        {/* rail */}
        <div style={s.rail}>
          <div style={s.railHead}>
            <div style={s.railTitleRow}>
              <h1 style={s.railTitle}>{t("page.heading")}</h1>
              <AddSkillMenu
                onCreate={createAndOpen}
                onImport={() => setImportMode("file")}
                onImportUrl={() => setImportMode("url")}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={14} style={s.searchIcon} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.railList}>
            {isLoading && (
              <div style={s.railSkeleton}>
                <Skeleton height={96} />
                <Skeleton height={96} />
                <Skeleton height={96} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && filtered.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setImportMode("file")}
              />
            )}
            {!isLoading &&
              !isError &&
              filtered.map((sk) => (
                <SkillRailCard
                  key={sk.id}
                  skill={sk}
                  active={sk.id === selectedId}
                  onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                  onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                />
              ))}
          </div>
        </div>

        {/* editor */}
        {!selectedId ? (
          <div style={s.placeholder}>
            <EmptyState
              icon="Sparkles"
              title={t("page.selectPrompt.title")}
              body={t("page.selectPrompt.body")}
            />
          </div>
        ) : skillLoading || !skill ? (
          <div style={s.editorSkeleton}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.editorPane}>
            <div style={s.editorHead}>
              <Icon.Sparkles size={18} style={s.editorIcon} />
              <h1 className="mono" style={s.editorTitle}>
                {skill.name}
              </h1>
              <Badge color="var(--text-secondary)">{t(`listItem.type.${skill.type}`)}</Badge>
              <Badge color="var(--text-muted)" mono>
                {t("editor.version", { version: skill.version })}
              </Badge>
              <div style={s.headSpacer}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="FlaskConical"
                  onClick={() => setTab("evals")}
                  title={t("editor.runEvalsTooltip")}
                >
                  {t("editor.runEvals")}
                </Button>
              </div>
            </div>
            <SkillEditor skill={skill} tab={tab} onTab={setTab} />
          </div>
        )}
      </div>

      {importMode && (
        <ImportSkillDrawer
          initialMode={importMode}
          onClose={() => setImportMode(null)}
          onImported={(id) => {
            setImportMode(null);
            router.push(`/skills/${id}?tab=config`);
          }}
        />
      )}
    </AppShell>
  );
}

export default SkillsView;
