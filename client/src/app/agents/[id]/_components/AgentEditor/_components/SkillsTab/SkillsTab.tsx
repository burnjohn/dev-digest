"use client";
import React from "react";
import { Badge, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkills, useAgentSkillLinks, useSetAgentSkills } from "../../../../../../../lib/hooks/skills";

export function SkillsTab({ agentId }: { agentId: string }) {
  const { data: allSkills, isLoading: skillsLoading } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkillLinks(agentId);
  const setSkills = useSetAgentSkills();

  const [orderedIds, setOrderedIds] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  // Initialize from server data
  React.useEffect(() => {
    if (links) {
      const sorted = [...links].sort((a, b) => a.order - b.order);
      setOrderedIds(sorted.map((l) => l.skill_id));
    }
  }, [links]);

  if (skillsLoading || linksLoading) return <Skeleton height={200} />;

  const skillMap = new Map((allSkills ?? []).map((s: Skill) => [s.id, s]));
  const linkedSet = new Set(orderedIds);

  const enabledCount = orderedIds.filter((id) => {
    const sk = skillMap.get(id);
    return sk?.enabled && linkedSet.has(id);
  }).length;

  const filteredSkills = (allSkills ?? []).filter((s: Skill) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleLink = (skillId: string) => {
    const next = linkedSet.has(skillId)
      ? orderedIds.filter((id) => id !== skillId)
      : [...orderedIds, skillId];
    setOrderedIds(next);
    setSkills.mutate({ agentId, skillIds: next });
  };

  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const next = [...orderedIds];
    const draggedId = next.splice(dragItem.current, 1)[0]!;
    next.splice(dragOverItem.current, 0, draggedId);
    dragItem.current = null;
    dragOverItem.current = null;
    setOrderedIds(next);
    setSkills.mutate({ agentId, skillIds: next });
  };

  return (
    <div style={{ maxWidth: 580 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {enabledCount} of {orderedIds.length} enabled
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter skills…"
          style={{
            marginLeft: "auto",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--text-primary)",
            outline: "none",
            width: 160,
          }}
        />
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        Order matters — drag to reorder.
      </p>

      {/* Linked skills (ordered, draggable) */}
      {orderedIds.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {orderedIds.map((skillId, idx) => {
            const sk = skillMap.get(skillId);
            if (!sk) return null;
            return (
              <div
                key={skillId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 6, marginBottom: 4,
                  border: "1px solid var(--border)", background: "var(--bg-surface)",
                  cursor: "grab",
                }}
              >
                <span style={{ color: "var(--text-muted)", cursor: "grab", flexShrink: 0, fontSize: 14 }}>⠿</span>
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggleLink(skillId)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{sk.name}</span>
                <Badge color="var(--text-secondary)" mono>{sk.type}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {/* Unlinked skills */}
      {filteredSkills
        .filter((s: Skill) => !linkedSet.has(s.id))
        .map((sk: Skill) => (
          <div
            key={sk.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 6, marginBottom: 4,
              border: "1px solid var(--border)", opacity: 0.7,
            }}
          >
            <div style={{ width: 14, flexShrink: 0 }} />
            <input
              type="checkbox"
              checked={false}
              onChange={() => toggleLink(sk.id)}
              style={{ cursor: "pointer", flexShrink: 0 }}
            />
            <span style={{ flex: 1, fontSize: 13 }}>{sk.name}</span>
            <Badge color="var(--text-secondary)" mono>{sk.type}</Badge>
          </div>
        ))}
    </div>
  );
}
