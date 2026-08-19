/* SmartDiffViewer — Smart Diff's "Files changed" alternative: files grouped
   by role (core → wiring → boilerplate, fixed order) instead of alphabetical/
   GitHub order. Reuses FileCard/CodeLine for the actual diff rendering (no
   duplicated patch-parsing logic) — this component only groups, badges, and
   drives FileCard's controlled open/highlight props for "jump to finding". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import type { SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import { type DiffCommentApi } from "@/components/diff-viewer/comments";
import { useSmartDiff } from "@/lib/hooks/reviews";
import { SMART_DIFF_GROUP_ORDER, DEFAULT_COLLAPSED_ROLES } from "./constants";

/** A finding currently scrolled-to/highlighted in the diff below. */
interface HighlightTarget {
  path: string;
  line: number;
}

/** A stub `PrFile` for a Smart Diff file DevDigest doesn't have the real
 *  `pr_files` row for (shouldn't normally happen — Smart Diff is built FROM
 *  `pr_files` server-side — but keeps FileCard rendering something sane
 *  rather than crashing if the two ever disagree). */
function toPrFile(file: SmartDiffFile, real: PrFile | undefined): PrFile {
  return (
    real ?? {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      patch: null,
    }
  );
}

function GroupHeader({
  role,
  count,
  collapsed,
  onToggle,
}: {
  role: SmartDiffRole;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("smartDiff");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 4px",
        background: "none",
        border: 0,
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
      }}
    >
      <Icon.ChevronRight
        size={14}
        style={{ transform: collapsed ? "none" : "rotate(90deg)", transition: "transform .12s" }}
      />
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t(`groups.${role}.title`)}</span>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t(`groups.${role}.subtitle`)}</span>
      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
        {t("fileCount", { count })}
      </span>
    </button>
  );
}

function SmartDiffFileEntry({
  file,
  realFile,
  commenting,
  open,
  onOpenChange,
  highlightLine,
  onHighlightMount,
  onFindingClick,
}: {
  file: SmartDiffFile;
  realFile: PrFile | undefined;
  commenting?: DiffCommentApi;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  highlightLine: number | null;
  onHighlightMount: (el: HTMLDivElement | null) => void;
  onFindingClick: (line: number) => void;
}) {
  const t = useTranslations("smartDiff");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {file.findings.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            padding: "0 4px",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>{t("findingsCount", { count: file.findings.length })}</span>
          {file.findings.map((f) => (
            <button
              key={f.line}
              type="button"
              onClick={() => onFindingClick(f.line)}
              title={t("jumpToFinding", { line: f.line })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: 0,
                padding: 0,
                background: "none",
                cursor: "pointer",
              }}
            >
              <SeverityBadge severity={f.severity} />
              <span className="mono tnum">L{f.line}</span>
            </button>
          ))}
        </div>
      )}
      <FileCard
        file={toPrFile(file, realFile)}
        commenting={commenting}
        open={open}
        onOpenChange={onOpenChange}
        highlightLine={highlightLine}
        onHighlightMount={onHighlightMount}
      />
    </div>
  );
}

export function SmartDiffViewer({
  prId,
  files,
  commenting,
}: {
  prId: string | null;
  /** The real `pr_files` rows (with `patch`) — Smart Diff's own file records
   *  don't carry the patch text, so FileCard's diff rendering is fed from
   *  here, matched by path. */
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("smartDiff");
  const { data: smartDiff, isLoading, error } = useSmartDiff(prId);

  const filesByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const f of files) map.set(f.path, f);
    return map;
  }, [files]);

  const [collapsedRoles, setCollapsedRoles] = React.useState<Set<SmartDiffRole>>(
    () => new Set(DEFAULT_COLLAPSED_ROLES),
  );
  const [openFiles, setOpenFiles] = React.useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = React.useState<HighlightTarget | null>(null);

  const roleByPath = React.useMemo(() => {
    const map = new Map<string, SmartDiffRole>();
    for (const group of smartDiff?.groups ?? []) {
      for (const f of group.files) map.set(f.path, group.role);
    }
    return map;
  }, [smartDiff]);

  function toggleGroup(role: SmartDiffRole) {
    setCollapsedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function handleFindingClick(path: string, line: number) {
    setHighlight({ path, line });
    setOpenFiles((prev) => ({ ...prev, [path]: true }));
    const role = roleByPath.get(path);
    if (role) setCollapsedRoles((prev) => (prev.has(role) ? new Set([...prev].filter((r) => r !== role)) : prev));
  }

  function handleHighlightMount(el: HTMLDivElement | null) {
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (isLoading) {
    return <div style={{ padding: 24, fontSize: 13, color: "var(--text-muted)" }}>{t("loading")}</div>;
  }
  if (error || !smartDiff) {
    return <div style={{ padding: 24, fontSize: 13, color: "var(--text-muted)" }}>{t("error")}</div>;
  }
  if (smartDiff.groups.every((g) => g.files.length === 0)) {
    return <div style={{ padding: 24, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>{t("empty")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {SMART_DIFF_GROUP_ORDER.map((role) => {
        const group = smartDiff.groups.find((g) => g.role === role);
        if (!group || group.files.length === 0) return null;
        const collapsed = collapsedRoles.has(role);
        return (
          <div key={role} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <GroupHeader role={role} count={group.files.length} collapsed={collapsed} onToggle={() => toggleGroup(role)} />
            {!collapsed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 4 }}>
                {group.files.map((file) => (
                  <SmartDiffFileEntry
                    key={file.path}
                    file={file}
                    realFile={filesByPath.get(file.path)}
                    commenting={commenting}
                    open={openFiles[file.path]}
                    onOpenChange={(next) => setOpenFiles((prev) => ({ ...prev, [file.path]: next }))}
                    highlightLine={highlight?.path === file.path ? highlight.line : null}
                    onHighlightMount={handleHighlightMount}
                    onFindingClick={(line) => handleFindingClick(file.path, line)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
