/* /skills — Skills Lab: master-detail list + Config/Preview/Evals/Stats/Versions tabs */
"use client";

import React, { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Dropdown, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { useSkills, useCreateSkill } from "../../lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { SkillDetail } from "./_components/SkillDetail/SkillDetail";
import { ImportDrawer } from "./_components/ImportDrawer";

export default function SkillsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError } = useSkills();
  const createSkill = useCreateSkill();

  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedId = search.get("id");
  const selectedSkill = skills?.find((s) => s.id === selectedId) ?? null;

  const filtered = useMemo(
    () =>
      (skills ?? []).filter(
        (s) =>
          !query ||
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase()),
      ),
    [skills, query],
  );

  const selectSkill = (id: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("id", id);
    router.replace(`/skills?${sp.toString()}`);
  };

  const deselectSkill = () => {
    const sp = new URLSearchParams(search.toString());
    sp.delete("id");
    router.replace(sp.toString() ? `/skills?${sp.toString()}` : "/skills");
  };

  const crumb = [{ label: "Skills Lab" }, { label: "Skills" }];

  const addItems = [
    {
      label: "Create from scratch",
      icon: "Edit" as const,
      onClick: () => {
        createSkill.mutate(
          { name: "New Skill", type: "custom", body: "# New Skill\n\nDescribe the skill here.", source: "manual" },
          {
            onSuccess: (skill) => selectSkill(skill.id),
          },
        );
      },
    },
    {
      label: "Import from file",
      icon: "Upload" as const,
      onClick: () => setImportOpen(true),
    },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* ---- left panel: skill list ---- */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Skills</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    Add Skill
                  </Button>
                }
                items={addItems}
              />
            </div>
            <div style={{ position: "relative" }}>
              <Icon.Search
                size={14}
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills..."
                style={{
                  width: "100%",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "6px 10px 6px 30px",
                  fontSize: 13,
                  color: "var(--text-primary)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0 8px 12px" }}>
            {isLoading && (
              <div style={{ padding: "8px" }}>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={88} style={{ marginBottom: 8, borderRadius: 8 }} />
                ))}
              </div>
            )}
            {isError && (
              <div style={{ padding: 16 }}>
                <ErrorState title="Could not load skills" body="" />
              </div>
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {query ? "No matching skills." : "No skills yet. Add one above."}
              </div>
            )}
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                active={skill.id === selectedId}
                onClick={() => selectSkill(skill.id)}
                onDelete={skill.id === selectedId ? deselectSkill : undefined}
              />
            ))}
          </div>
        </div>

        {/* ---- right panel: skill detail ---- */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {selectedSkill ? (
            <SkillDetail skill={selectedSkill} />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                gap: 12,
              }}
            >
              <Icon.Puzzle size={40} style={{ opacity: 0.25 }} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>Select a skill</div>
              <div style={{ fontSize: 13 }}>Pick a skill on the left to view and edit it.</div>
            </div>
          )}
        </div>
      </div>

      <ImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(skill) => {
          setImportOpen(false);
          selectSkill(skill.id);
        }}
      />
    </AppShell>
  );
}
