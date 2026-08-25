"use client";

import React from "react";
import type { SmartDiffFile } from "@devdigest/shared";
import { s } from "./styles";

interface FileRowProps {
  file: SmartDiffFile;
  defaultCollapsed?: boolean;
  isLast?: boolean;
  onFindingClick?: (path: string, line: number) => void;
}

export function FileRow({ file, defaultCollapsed = false, isLast = false, onFindingClick }: FileRowProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  return (
    <div style={isLast ? s.fileRowLast : s.fileRow}>
      <div style={s.fileHeader} onClick={() => setCollapsed((c) => !c)}>
        <span style={s.chevron(!collapsed)}>▶</span>
        <span style={s.filePath} title={file.path}>
          {file.path}
        </span>
        {file.additions > 0 && <span style={s.additions}>+{file.additions}</span>}
        {file.deletions > 0 && <span style={s.deletions}>-{file.deletions}</span>}
        {file.finding_lines.length > 0 && (
          <span
            style={s.findingBadge}
            title={`Findings on lines: ${file.finding_lines.join(", ")}`}
            onClick={(e) => {
              e.stopPropagation();
              const firstLine = file.finding_lines[0];
              if (firstLine != null) onFindingClick?.(file.path, firstLine);
            }}
          >
            {file.finding_lines.length} findings
          </span>
        )}
      </div>
      {!collapsed && <div style={s.emptyBody}>Patch view coming soon.</div>}
    </div>
  );
}
