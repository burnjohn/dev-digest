/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { type DiffAnnotationApi } from "../annotations";
import { s, chevronFor, annotationChip, annotationDot, orphanItem } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  annotations,
  defaultOpen,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  annotations?: DiffAnnotationApi;
  /** Overrides the AUTO_EXPAND_MAX_LINES seed when provided — Smart Diff's
   *  server-computed `SmartDiffFile.default_open` (REQ-3). */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  // Fresh on every render — never memoized by finding id, or a stale id would
  // survive a re-run (see docs/plans/04-smart-diff.md §5.7).
  const headerAnnotation = annotations ? annotations.headerFor(file.path) : null;
  const orphanAnnotations = annotations ? annotations.orphansFor(file.path) : [];

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span style={s.filePathRow}>
          <span className="mono" style={s.filePath}>
            {file.path}
          </span>
          {/* REQ-29: a collapsed file must still advertise its findings — this
              renders whether `open` is true or false, never inside the body. */}
          {headerAnnotation && (
            <>
              <span style={annotationDot(headerAnnotation.severity)} />
              <button
                type="button"
                style={annotationChip(headerAnnotation.severity)}
                aria-label={headerAnnotation.title}
                title={headerAnnotation.title}
                onClick={(e) => {
                  e.stopPropagation();
                  headerAnnotation.onClick();
                }}
              >
                {headerAnnotation.label}
                {headerAnnotation.count != null && headerAnnotation.count > 1
                  ? ` ×${headerAnnotation.count}`
                  : ""}
              </button>
            </>
          )}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {orphanAnnotations.length > 0 && (
        <div style={s.orphanList}>
          {orphanAnnotations.map((o) => (
            <button
              key={o.key}
              type="button"
              style={orphanItem}
              aria-label={o.title}
              title={o.title}
              onClick={o.onClick}
            >
              <span style={annotationDot(o.severity)} />
              {o.label}
              {o.count != null && o.count > 1 ? ` ×${o.count}` : ""}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                annotations={annotations}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
