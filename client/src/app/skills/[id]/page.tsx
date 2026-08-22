/* /skills/:id — Skill Editor. Left skill list + multi-tab SkillEditor on the right.
   Tab state lives in ?tab=. Mirrors agents/[id]/page.tsx. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button, Dropdown, ErrorState, Skeleton, Icon, Badge } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { SkillCard } from "../_components/SkillCard";
import { SkillEditor } from "./_components/SkillEditor";
import { ImportDrawer } from "../_components/ImportDrawer";
import { useSkills, useSkill, useUpdateSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";

const VALID_TABS = ["config", "preview", "versions", "stats"];

export default function SkillEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();
  const [importOpen, setImportOpen] = React.useState(false);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: "Skills Lab" },
    { label: "Skills", href: "/skills" },
    { label: skill?.name ?? "Skill" },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this skill"
          body={error instanceof ApiError ? error.message : "The skill could not be loaded."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {importOpen && <ImportDrawer onClose={() => setImportOpen(false)} />}
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: skill list */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Skills</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    Add Skill
                  </Button>
                }
                items={[
                  { label: "Import from file", icon: "Upload", onClick: () => setImportOpen(true) },
                ]}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
            {(skills ?? []).map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div
            style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 28px 0",
                flexShrink: 0,
              }}
            >
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {skill.type}
              </Badge>
              <Badge color="var(--text-muted)" mono>
                v{skill.version}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
