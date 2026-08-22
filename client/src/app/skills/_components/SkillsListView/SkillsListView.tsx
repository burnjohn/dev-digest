/* SkillsListView — /skills page. Split pane: list left, editor right. */
"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { SkillCard } from "../SkillCard/SkillCard";
import { CreateSkillModal } from "../CreateSkillModal/CreateSkillModal";

export function SkillsListView({ activeId }: { activeId?: string } = {}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [creating, setCreating] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills") },
  ];

  const filtered = (skills ?? []).filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell crumb={crumb}>
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/skills/${id}`);
          }}
        />
      )}
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* Left: list pane */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>
                {t("page.heading")}
              </h1>
              <Button
                kind="primary"
                size="sm"
                icon="Plus"
                onClick={() => setCreating(true)}
              >
                {t("page.addSkill")}
              </Button>
            </div>
            <div style={{ position: "relative" }}>
              <Icon.Search
                size={13}
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={{
                  width: "100%",
                  padding: "6px 8px 6px 28px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-elevated)",
                  fontSize: 13,
                  color: "var(--text-primary)",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "0 12px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {isLoading && (
              <>
                <Skeleton height={72} />
                <Skeleton height={72} />
                <Skeleton height={72} />
              </>
            )}
            {isError && (
              <ErrorState
                body={t("page.loadError")}
                onRetry={() => refetch()}
              />
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setCreating(true)}
              />
            )}
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                active={skill.id === activeId}
                onClick={() => router.push(`/skills/${skill.id}`)}
              />
            ))}
          </div>
        </div>

        {/* Right: editor slot — filled by /skills/[id]/page.tsx children */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
          }}
        >
          {!activeId && (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                {t("page.selectPrompt.title")}
              </p>
              <p style={{ fontSize: 13 }}>{t("page.selectPrompt.body")}</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
