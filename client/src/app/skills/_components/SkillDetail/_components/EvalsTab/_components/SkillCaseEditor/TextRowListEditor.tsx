"use client";

/* TextRowListEditor — small presentational add/remove text-row list editor,
   shared by SkillCaseEditor's practices and grounding sections (both are the
   same add/remove-row shape, only labels/placeholders differ). Extracted to
   keep SkillCaseEditor.tsx under the ~200-line component budget. */

import React from "react";
import { Button, TextInput } from "@devdigest/ui";
import { s } from "../../styles";

export interface TextListRow {
  key: string;
  value: string;
}

interface TextRowListEditorProps {
  sectionLabel: string;
  hint: string;
  addLabel: string;
  removeLabel: string;
  rowPlaceholder: string;
  rows: TextListRow[];
  onAdd: () => void;
  onChange: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  mono?: boolean;
}

export function TextRowListEditor({
  sectionLabel,
  hint,
  addLabel,
  removeLabel,
  rowPlaceholder,
  rows,
  onAdd,
  onChange,
  onRemove,
  mono,
}: TextRowListEditorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={s.sectionSubLabel}>{sectionLabel}</span>
        <Button kind="secondary" size="sm" icon="Plus" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      <span style={s.smallLabel}>{hint}</span>
      {rows.map((row) => (
        <div key={row.key} style={s.listEditorRow}>
          <TextInput
            value={row.value}
            onChange={(v) => onChange(row.key, v)}
            placeholder={rowPlaceholder}
            mono={mono}
          />
          <Button kind="ghost" size="sm" onClick={() => onRemove(row.key)}>
            {removeLabel}
          </Button>
        </div>
      ))}
    </div>
  );
}
