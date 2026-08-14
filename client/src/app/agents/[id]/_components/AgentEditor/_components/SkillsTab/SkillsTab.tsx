/* SkillsTab — attach, detach and reorder the skills an agent uses. The order
   here IS the order of the blocks in the assembled prompt. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "../../../../../../../lib/hooks/skills";
import { SkillRow } from "./SkillRow";
import { arrangeSkills, attachedIdsInOrder, filterSkills, moveItem } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const [search, setSearch] = React.useState("");

  // Derived, not mirrored. `useSetAgentSkills` writes the new order into the
  // query cache before the request goes out, so a drag moves the row on the next
  // render without a second source of truth that a background refetch of
  // ["skills"] or ["agent-skills"] could silently undo mid-drag.
  const ordered = React.useMemo(
    () => arrangeSkills(skills ?? [], links ?? []),
    [skills, links],
  );

  const attached = React.useMemo(
    () => new Set((links ?? []).map((l) => l.skill_id)),
    [links],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = (next: Skill[], nextAttached: ReadonlySet<string>) =>
    setSkills.mutate({ agentId: agent.id, skillIds: attachedIdsInOrder(next, nextAttached) });

  const toggle = (skill: Skill, on: boolean) => {
    const nextAttached = new Set(attached);
    if (on) nextAttached.add(skill.id);
    else nextAttached.delete(skill.id);
    persist(ordered, nextAttached);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((sk) => sk.id === active.id);
    const to = ordered.findIndex((sk) => sk.id === over.id);
    persist(moveItem(ordered, from, to), attached);
  };

  if (isLoading || linksLoading) {
    return (
      <div style={s.list}>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }
  // Both queries feed the list. Without the links half, `ordered` would be a
  // plain alphabetical list with nothing attached — which renders as a perfectly
  // calm, perfectly wrong tab.
  if (isError || linksError) {
    return (
      <ErrorState
        body={t("skills.loadError")}
        onRetry={() => {
          void refetch();
          void refetchLinks();
        }}
      />
    );
  }

  if ((skills ?? []).length === 0) {
    return (
      <EmptyState
        icon="Sparkles"
        title={t("skills.emptyTitle")}
        body={t("skills.emptyBody")}
        cta={t("skills.emptyCta")}
        onCta={() => router.push("/skills")}
      />
    );
  }

  const visible = filterSkills(ordered, search);
  // Dragging a filtered list would reorder against positions the user cannot
  // see, so reordering is off until the filter is cleared.
  const canDrag = search.trim().length === 0;

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.title}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: attached.size, total: (skills ?? []).length })}
        </Badge>
        <div style={s.spacer} />
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{canDrag ? t("skills.orderHint") : t("skills.filterDragHint")}</p>

      {visible.length === 0 ? (
        <EmptyState icon="Search" title={t("skills.noMatchTitle")} body={t("skills.noMatchBody")} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={visible.map((sk) => sk.id)}
            strategy={verticalListSortingStrategy}
          >
            <div role="list" style={s.list}>
              {visible.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  attached={attached.has(skill.id)}
                  draggable={canDrag}
                  onToggle={(on) => toggle(skill, on)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
