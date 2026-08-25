"use client";

import React from "react";
import type { SmartDiffGroup } from "@devdigest/shared";
import { useSmartDiff } from "@/lib/hooks/reviews";
import { FileRow } from "./FileRow";
import { s } from "./styles";

const SECTION_META: Record<
  "core" | "wiring" | "boilerplate",
  { label: string; defaultCollapsed: boolean }
> = {
  core: { label: "Business Logic", defaultCollapsed: false },
  wiring: { label: "Config & Wiring", defaultCollapsed: false },
  boilerplate: { label: "Generated & Lock Files", defaultCollapsed: true },
};

function GroupSection({
  group,
  onFindingClick,
}: {
  group: SmartDiffGroup;
  onFindingClick?: (path: string, line: number) => void;
}) {
  const meta = SECTION_META[group.role];
  const [sectionCollapsed, setSectionCollapsed] = React.useState(meta.defaultCollapsed);
  if (group.files.length === 0) return null;

  return (
    <div style={s.section}>
      <div
        style={{ ...s.sectionHeader, cursor: "pointer", userSelect: "none" }}
        onClick={() => setSectionCollapsed((c) => !c)}
      >
        <span style={{ marginRight: 6, fontSize: 10, display: "inline-block", transform: sectionCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s" }}>▶</span>
        <span style={s.sectionTitle}>{meta.label}</span>
        <span style={s.fileCount}>{group.files.length} files</span>
      </div>
      {!sectionCollapsed && (
        <div style={s.fileList}>
          {group.files.map((file, i) => (
            <FileRow
              key={file.path}
              file={file}
              defaultCollapsed={false}
              isLast={i === group.files.length - 1}
              onFindingClick={onFindingClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SmartDiffViewerProps {
  prId: string;
  onFindingClick?: (path: string, line: number) => void;
}

export function SmartDiffViewer({ prId, onFindingClick }: SmartDiffViewerProps) {
  const { data, isPending, isError } = useSmartDiff(prId);

  if (isPending) {
    return <div style={s.spinner}>Loading…</div>;
  }

  if (isError || !data) {
    return <div style={s.spinner}>Failed to load Smart Diff.</div>;
  }

  return (
    <div style={s.root}>
      {data.groups.map((group) => (
        <GroupSection key={group.role} group={group} onFindingClick={onFindingClick} />
      ))}
    </div>
  );
}
