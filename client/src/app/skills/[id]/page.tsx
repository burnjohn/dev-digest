/* /skills/[id] — Skill editor page. Split: list left + editor right. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { useSkills, useSkill } from "@/lib/hooks/skills";
import { SkillCard } from "../_components/SkillCard/SkillCard";
import { CreateSkillModal } from "../_components/CreateSkillModal/CreateSkillModal";
import { SkillEditor } from "./_components/SkillEditor/SkillEditor";
import { Button, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";

export default function SkillDetailPage() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skills, isLoading: listLoading } = useSkills();
  const {
    data: skill,
    isLoading: skillLoading,
    isError,
    refetch,
  } = useSkill(id);

  // Redirect to /skills when the current skill is deleted or not found
  React.useEffect(() => {
    if (!skillLoading && !skill && !isError) {
      router.replace("/skills");
    }
  }, [skill, skillLoading, isError, router]);
  const [creating, setCreating] = React.useState(false);
  const [listSearch, setListSearch] = React.useState("");

  const tab = search.get("tab") ?? "config";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  const filtered = (skills ?? []).filter(
    (s) =>
      !listSearch ||
      s.name.toLowerCase().includes(listSearch.toLowerCase()) ||
      s.description?.toLowerCase().includes(listSearch.toLowerCase()),
  );

  return (
    <AppShell crumb={crumb}>
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={(newId) => {
            setCreating(false);
            router.push(`/skills/${newId}`);
          }}
        />
      )}
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* Left: skill list */}
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
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
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
            {listLoading && <Skeleton height={72} />}
            {filtered.map((s) => (
              <SkillCard
                key={s.id}
                skill={s}
                active={s.id === id}
                onClick={() => router.push(`/skills/${s.id}?tab=${tab}`)}
                onDeleted={() => { if (s.id === id) router.push("/skills"); }}
              />
            ))}
          </div>
        </div>

        {/* Right: editor */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {skillLoading || !skill ? (
            <div
              style={{
                padding: 28,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <Skeleton height={24} width={240} />
              <Skeleton height={300} />
            </div>
          ) : isError ? (
            <ErrorState
              fullScreen
              title={t("detail.loadError")}
              body={t("detail.notFound.body")}
              onRetry={() => refetch()}
            />
          ) : (
            <SkillEditor skill={skill} tab={tab} onTab={setTab} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
