"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parsePatch } from "@/components/diff-viewer/helpers";
import type { SmartDiff, SmartDiffGroup, SmartDiffFile } from "@devdigest/shared";

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  prId: string;
  patches: Record<string, string | null | undefined>;
}

const ROLE_META: Record<string, { label: string; description: string; color: string }> = {
  core:        { label: "Core logic",  description: "The substance of the change — review closely", color: "#4a9eff" },
  wiring:      { label: "Wiring",      description: "Hooks the core into the app",                  color: "#f0b429" },
  boilerplate: { label: "Boilerplate", description: "Generated / mechanical — skim",                color: "#6b7280" },
};

const ROLE_ORDER: string[] = ["core", "wiring", "boilerplate"];

function getSeverityColor(severity: string): string {
  if (severity === "critical") return "var(--crit)";
  if (severity === "warning") return "var(--warn)";
  return "var(--sugg)";
}

function getHighestSeverityColor(findings: SmartDiffFile["findings"]): string {
  if (!findings || findings.length === 0) return "var(--sugg)";
  if (findings.some((f) => f.severity === "critical")) return "var(--crit)";
  if (findings.some((f) => f.severity === "warning")) return "var(--warn)";
  return "var(--sugg)";
}

// Maps internal severity to display label (critical → "blocker")
function getSeverityLabel(severity: string): string {
  if (severity === "critical") return "blocker";
  return severity;
}

// Unicode icons matching the Lucide AlertOctagon / AlertTriangle / Lightbulb family
function getSeverityIcon(severity: string): string {
  if (severity === "critical") return "⊘";
  if (severity === "warning") return "△";
  return "○";
}

interface FileViewProps {
  file: SmartDiffFile;
  patch: string | null | undefined;
  onNavigateToFinding: (findingId: string) => void;
  targetFile: string | null;
  targetLine: string | null;
}

/** Transient highlight tint — same blue accent already used in this file for the "summary" badge. */
const HIGHLIGHT_BG = "rgba(74,158,255,0.18)";
const HIGHLIGHT_MS = 1500;

function FileView({ file, patch, onNavigateToFinding, targetFile, targetLine }: FileViewProps) {
  const isTarget = targetFile === file.path;
  const [expanded, setExpanded] = React.useState(true);
  const [highlightedLineId, setHighlightedLineId] = React.useState<string | null>(null);
  const lines = parsePatch(patch);

  // Force-expand when this file becomes the navigation target (don't fight manual collapse otherwise).
  React.useEffect(() => {
    if (isTarget) setExpanded(true);
  }, [isTarget, targetFile]);

  // Scroll to + transiently highlight the target line. Falls back to the file container
  // when the line anchor doesn't exist (e.g. review_focus items default to line=1, which
  // is rarely a rendered diff row) so navigation still lands somewhere visible instead of
  // silently doing nothing. The file-fallback scrolls with `block: "start"` (file header at
  // top of viewport) rather than "center" — on a tall file, centering the container lands
  // the user mid-diff, which looks random rather than "this file just opened."
  React.useEffect(() => {
    if (!isTarget || typeof document === "undefined") return;
    const lineId = targetLine ? `diff-line-${targetFile}-${targetLine}` : null;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Double-rAF: after force-expand flips `expanded`, the file's diff rows render on the
    // next paint — a single rAF can still fire before that DOM update commits.
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const lineEl = lineId ? document.getElementById(lineId) : null;
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightedLineId(lineId);
          timer = setTimeout(() => setHighlightedLineId(null), HIGHLIGHT_MS);
        } else {
          const fileEl = document.getElementById(`diff-file-${targetFile}`);
          fileEl?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, [isTarget, targetFile, targetLine, expanded]);

  return (
    <div id={`diff-file-${file.path}`} style={{ marginBottom: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
      {/* File header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--bg-hover)",
          cursor: "pointer",
          borderRadius: expanded ? "6px 6px 0 0" : 6,
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {expanded ? "▾" : "▸"}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.path}
          </span>
          {file.findings?.some((f) => f.severity === "critical") && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--crit)",
                flexShrink: 0,
                display: "inline-block",
              }}
            />
          )}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: "#4a9eff",
            background: "rgba(74,158,255,0.12)",
            border: "1px solid rgba(74,158,255,0.25)",
            borderRadius: 4,
            padding: "2px 8px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          </svg>
          summary
        </span>
        <span style={{ fontSize: 11, color: "#4caf50", flexShrink: 0 }}>
          +{file.additions}
        </span>
        <span style={{ fontSize: 11, color: "#f44336", flexShrink: 0 }}>
          -{file.deletions}
        </span>
      </div>

      {/* "What this does" row — only when summary exists and file is expanded */}
      {expanded && file.pseudocode_summary && (
        <div
          style={{
            padding: "5px 12px 5px 28px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)", marginRight: 6, flexShrink: 0 }}>
            <path d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z" />
          </svg>
          <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>What this does:</span>{" "}
          {file.pseudocode_summary}
        </div>
      )}

      {/* File diff content */}
      {expanded && (
        <div style={{ overflowX: "auto" }}>
          {!patch ? (
            <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
              Patch not available
            </div>
          ) : (
            <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: "18px" }}>
              {(() => {
                // Snap each finding to nearest add/del line at or after startLine
                const findingDisplayMap = new Map<number, NonNullable<typeof file.findings>[number]>();
                if (file.findings?.length) {
                  const changedLines = lines
                    .filter((l) => (l.kind === "add" || l.kind === "del") && (l.newNo ?? l.oldNo) != null)
                    .map((l) => l.newNo ?? l.oldNo!);
                  for (const finding of file.findings) {
                    const target = changedLines.find((n) => n >= finding.startLine) ?? changedLines[changedLines.length - 1];
                    if (target != null && !findingDisplayMap.has(target)) {
                      findingDisplayMap.set(target, finding);
                    }
                  }
                }
                return lines.map((line, idx) => {
                if (line.kind === "hunk") {
                  return (
                    <div
                      key={idx}
                      style={{
                        background: "#1a2030",
                        color: "var(--text-muted)",
                        padding: "2px 8px",
                        fontSize: 11,
                      }}
                    >
                      @@ hunk @@
                    </div>
                  );
                }

                const lineNoRaw = line.newNo ?? line.oldNo;
                const lineNo = lineNoRaw ?? "";
                const findingOnLine = lineNoRaw != null
                  ? findingDisplayMap.get(lineNoRaw)
                  : undefined;
                const lineId = lineNoRaw != null ? `diff-line-${file.path}-${lineNoRaw}` : undefined;
                const isHighlighted = lineId != null && lineId === highlightedLineId;

                let bg = "transparent";
                let borderLeft = "3px solid transparent";
                let prefix = " ";

                if (line.kind === "add") {
                  bg = "rgba(76, 175, 80, 0.1)";
                  borderLeft = "3px solid rgba(76, 175, 80, 0.6)";
                  prefix = "+";
                } else if (line.kind === "del") {
                  bg = "rgba(244, 67, 54, 0.1)";
                  borderLeft = "3px solid rgba(244, 67, 54, 0.6)";
                  prefix = "-";
                }

                if (isHighlighted) bg = HIGHLIGHT_BG;

                return (
                  <div
                    key={idx}
                    id={lineId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: bg,
                      borderLeft,
                      minHeight: 18,
                      minWidth: "100%",
                      transition: "background 0.3s ease",
                    }}
                  >
                    {/* Line number gutter */}
                    <span
                      style={{
                        minWidth: 40,
                        textAlign: "right",
                        paddingRight: 8,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        userSelect: "none",
                        flexShrink: 0,
                      }}
                    >
                      {lineNo}
                    </span>
                    {/* Prefix (+/-/ ) */}
                    <span
                      style={{
                        width: 14,
                        color:
                          line.kind === "add"
                            ? "#4caf50"
                            : line.kind === "del"
                              ? "#f44336"
                              : "var(--text-muted)",
                        flexShrink: 0,
                        userSelect: "none",
                      }}
                    >
                      {prefix}
                    </span>
                    {/* Line content — flexGrow fills row, flexShrink:0 lets long lines overflow for scroll */}
                    <span style={{ flexGrow: 1, flexShrink: 0, whiteSpace: "pre", color: "var(--text-primary)" }}>
                      {line.text}
                    </span>
                    {/* Finding badge — icon + label (critical shows as "blocker") */}
                    {findingOnLine && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToFinding(findingOnLine.id);
                        }}
                        title={`[${findingOnLine.category}] ${findingOnLine.title}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          flexShrink: 0,
                          position: "sticky",
                          right: 6,
                          zIndex: 1,
                          marginLeft: 8,
                          padding: "1px 8px",
                          border: "none",
                          background: "transparent",
                          color: getSeverityColor(findingOnLine.severity),
                          fontSize: 11,
                          fontWeight: 400,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {getSeverityIcon(findingOnLine.severity)}{" "}
                        {getSeverityLabel(findingOnLine.severity)}
                      </button>
                    )}
                  </div>
                );
              });
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface GroupViewProps {
  group: SmartDiffGroup;
  patches: Record<string, string | null | undefined>;
  onNavigateToFinding: (findingId: string) => void;
  targetFile: string | null;
  targetLine: string | null;
}

function GroupView({ group, patches, onNavigateToFinding, targetFile, targetLine }: GroupViewProps) {
  const meta = ROLE_META[group.role] ?? { label: group.role, description: "", color: "#6b7280" };
  const hasTarget = targetFile != null && group.files.some((f) => f.path === targetFile);
  const [expanded, setExpanded] = React.useState(group.role !== "boilerplate" || hasTarget);

  // Force-expand a collapsed (e.g. boilerplate) group when it holds the navigation target.
  React.useEffect(() => {
    if (hasTarget) setExpanded(true);
  }, [hasTarget]);

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Group header */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--bg-hover)",
          borderRadius: 8,
          cursor: "pointer",
          userSelect: "none",
          marginBottom: expanded ? 8 : 0,
        }}
      >
        {/* Role colour dot */}
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: meta.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>
          {meta.label}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>
          {meta.description}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            background: "rgba(255,255,255,0.07)",
            borderRadius: 10,
            padding: "1px 7px",
            flexShrink: 0,
          }}
        >
          {group.files.length} file{group.files.length !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {/* Files */}
      {expanded && (
        <div style={{ paddingLeft: 0 }}>
          {(() => {
            // Dedupe by path — server smart-diff composition can emit the same file
            // more than once within a group for large PRs, which would otherwise
            // produce a duplicate React key AND duplicate DOM anchor ids
            // (`diff-file-${path}`, `diff-line-${path}-${line}`), breaking internal nav.
            const seen = new Set<string>();
            const uniqueFiles = group.files.filter((f) => {
              if (seen.has(f.path)) return false;
              seen.add(f.path);
              return true;
            });
            return uniqueFiles.map((file) => (
              <FileView
                key={file.path}
                file={file}
                patch={patches[file.path]}
                onNavigateToFinding={onNavigateToFinding}
                targetFile={targetFile}
                targetLine={targetLine}
              />
            ));
          })()}
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({ smartDiff, patches }: SmartDiffViewerProps) {
  const router = useRouter();
  const search = useSearchParams();
  const targetFile = search?.get("file") ?? null;
  const targetLine = search?.get("line") ?? null;

  function navigateToFinding(findingId: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "findings");
    params.set("findingId", findingId);
    router.replace(`?${params.toString()}`);
  }

  // Sort groups: core → wiring → boilerplate
  const sortedGroups = [...smartDiff.groups].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role);
    const bi = ROLE_ORDER.indexOf(b.role);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div>
      {sortedGroups.map((group) => (
        <GroupView
          key={group.role}
          group={group}
          patches={patches}
          onNavigateToFinding={navigateToFinding}
          targetFile={targetFile}
          targetLine={targetLine}
        />
      ))}
    </div>
  );
}
