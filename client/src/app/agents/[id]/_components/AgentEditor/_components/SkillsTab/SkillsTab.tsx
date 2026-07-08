"use client";

import React, { useState } from "react";
import { Badge, Button, Skeleton, Icon } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "@/lib/hooks/skills";

const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--info)",
};

interface SkillsTabProps {
  agent: Agent;
}

export function SkillsTab({ agent }: SkillsTabProps) {
  const { data: allSkills, isLoading: loadingSkills } = useSkills();
  const { data: linkedLinks, isLoading: loadingLinked } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);

  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const isLoading = loadingSkills || loadingLinked;

  // Ordered list of linked skill IDs
  const linkedIds: string[] = (linkedLinks ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((l) => l.skill_id);

  const linkedSet = new Set(linkedIds);

  const filteredSkills = (allSkills ?? []).filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase()),
  );

  const linkedSkills: Skill[] = linkedIds
    .map((id) => allSkills?.find((s) => s.id === id))
    .filter((s): s is Skill => !!s);

  const unlinkedSkills = filteredSkills.filter((s) => !linkedSet.has(s.id));

  const attach = (skillId: string) => {
    setSkills.mutate([...linkedIds, skillId]);
  };

  const detach = (skillId: string) => {
    setSkills.mutate(linkedIds.filter((id) => id !== skillId));
  };

  const moveUp = (skillId: string) => {
    const idx = linkedIds.indexOf(skillId);
    if (idx <= 0) return;
    const next = [...linkedIds];
    const tmp = next[idx - 1]!;
    next[idx - 1] = next[idx]!;
    next[idx] = tmp;
    setSkills.mutate(next);
  };

  const moveDown = (skillId: string) => {
    const idx = linkedIds.indexOf(skillId);
    if (idx < 0 || idx >= linkedIds.length - 1) return;
    const next = [...linkedIds];
    const tmp = next[idx]!;
    next[idx] = next[idx + 1]!;
    next[idx + 1] = tmp;
    setSkills.mutate(next);
  };

  // Drag-and-drop reorder
  const handleDragStart = (skillId: string) => setDragging(skillId);
  const handleDragEnd = () => {
    if (dragging && dragOver && dragging !== dragOver) {
      const from = linkedIds.indexOf(dragging);
      const to = linkedIds.indexOf(dragOver);
      if (from >= 0 && to >= 0) {
        const next = [...linkedIds];
        next.splice(from, 1);
        next.splice(to, 0, dragging);
        setSkills.mutate(next);
      }
    }
    setDragging(null);
    setDragOver(null);
  };

  if (isLoading) {
    return (
      <div style={{ padding: 28 }}>
        {[1, 2, 3].map((i) => <Skeleton key={i} height={56} style={{ marginBottom: 8 }} />)}
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Skills</h2>
          {linkedIds.length > 0 && (
            <Badge color="var(--text-muted)">
              {linkedIds.length} linked
            </Badge>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Order matters &mdash; earlier skills appear earlier in the assembled prompt. Toggle to attach.
        </p>
      </div>

      {/* Linked skills (ordered, drag to reorder) */}
      {linkedSkills.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Linked skills (in prompt order)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {linkedSkills.map((skill, idx) => (
              <div
                key={skill.id}
                draggable
                onDragStart={() => handleDragStart(skill.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(skill.id); }}
                onDragEnd={handleDragEnd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: dragOver === skill.id ? "var(--bg-hover)" : "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: "grab",
                  opacity: dragging === skill.id ? 0.5 : 1,
                  transition: "background 80ms",
                }}
              >
                <Icon.Dot size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 18, textAlign: "center" }}>
                  {idx + 1}
                </span>
                <Icon.Puzzle size={14} style={{ color: TYPE_COLOR[skill.type] ?? "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{skill.name}</div>
                  {skill.description && (
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {skill.description}
                    </div>
                  )}
                </div>
                <Badge color={TYPE_COLOR[skill.type] ?? "var(--info)"}>{skill.type}</Badge>
                {!skill.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => moveUp(skill.id)}
                    disabled={idx === 0}
                    style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 1, padding: 4, color: "var(--text-muted)" }}
                    title="Move up"
                  >
                    <Icon.ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveDown(skill.id)}
                    disabled={idx === linkedSkills.length - 1}
                    style={{ background: "none", border: "none", cursor: idx === linkedSkills.length - 1 ? "default" : "pointer", opacity: idx === linkedSkills.length - 1 ? 0.3 : 1, padding: 4, color: "var(--text-muted)" }}
                    title="Move down"
                  >
                    <Icon.ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => detach(skill.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--text-muted)" }}
                    title="Detach skill"
                  >
                    <Icon.X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available skills */}
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
          Available skills
        </div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Icon.Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills..."
            style={{
              width: "100%",
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px 6px 28px",
              fontSize: 12,
              color: "var(--text-primary)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {unlinkedSkills.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
            {filter ? "No matching unlinked skills." : "All available skills are already linked."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {unlinkedSkills.map((skill) => (
            <div
              key={skill.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                opacity: skill.enabled ? 1 : 0.65,
              }}
            >
              <Icon.Puzzle size={14} style={{ color: TYPE_COLOR[skill.type] ?? "var(--text-muted)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{skill.name}</div>
              </div>
              <Badge color={TYPE_COLOR[skill.type] ?? "var(--text-muted)"}>{skill.type}</Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
              <Button kind="secondary" size="sm" onClick={() => attach(skill.id)}>
                Attach
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
