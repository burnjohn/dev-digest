/* SkillRow — one draggable row in the agent's Skills tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function SkillRow({
  skill,
  attached,
  draggable,
  onToggle,
}: {
  skill: Skill;
  attached: boolean;
  /** False while a filter is active — the visible subset is not the real order. */
  draggable: boolean;
  onToggle: (attached: boolean) => void;
}) {
  const t = useTranslations("agents");
  // The type labels live in the `skills` namespace — one translation, not two.
  const ts = useTranslations("skills");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      // The list is a real list, so a row is addressable as one item rather than
      // by its position among all the checkboxes on the page. `Checkbox` renders
      // a `role="checkbox"` button inside a `<label>`, and a label does not name
      // a non-form-control — so without this the checkbox has no accessible name
      // at all and nothing can query it except by index.
      role="listitem"
      aria-label={skill.name}
      style={{
        ...s.row(attached, isDragging),
        // Written out rather than via `CSS.Transform.toString` from
        // @dnd-kit/utilities: that package is only a transitive dependency of
        // @dnd-kit/sortable, and importing it directly would rely on pnpm
        // hoisting. A sortable list only ever translates.
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={t("skills.dragHandleLabel", { name: skill.name })}
        disabled={!draggable}
        style={s.handle(draggable)}
      >
        <Icon.Menu size={14} />
      </button>

      <Checkbox
        checked={attached}
        onChange={onToggle}
        label={
          <span className="mono" style={s.name}>
            {skill.name}
          </span>
        }
      />

      {attached && !skill.enabled && (
        <span style={s.disabledNote} title={t("skills.disabledHint")}>
          <Icon.AlertTriangle size={12} />
        </span>
      )}

      <Badge color="var(--text-muted)">{ts(`listItem.type.${skill.type}`)}</Badge>
    </div>
  );
}
