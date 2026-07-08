"use client";

/* ContextDocsList — shared unified checkbox picker (v2 design-mock parity) for
   attaching Project Context documents to an owner (agent or skill). A SINGLE
   list: each row = drag handle (only when attached) + checkbox (checked =
   attached) + path + category badge + token count + Preview. Attached docs sort
   first, in persisted order, and are the only draggable/reorderable rows (order
   matters — earlier docs inject earlier). Consumed by the agent editor Context
   tab and the skill editor Context tab via a pre-scoped translator. */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, Icon, IconBtn, Checkbox, Modal } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { categoryBadgeColor } from "@/app/repos/[repoId]/context/_components/ContextDocsView/styles";
import { DocPreviewPane } from "@/app/repos/[repoId]/context/_components/ContextDocsView/_components/DocPreviewPane";
import { useContextDocContent } from "@/lib/hooks/context-docs";

type T = ReturnType<typeof useTranslations>;

function fallbackDoc(path: string): ContextDocument {
  return {
    path,
    category: path.split("/")[0] ?? "unknown",
    token_count: 0,
    used_by_agents: 0,
    coverage: 0,
    source: "clone",
  };
}

// ---- Preview modal (replaces the retired PreviewModal; content via hook) ----

function PreviewModalInline({
  t,
  repoId,
  path,
  onClose,
}: {
  t: T;
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useContextDocContent(repoId, path);
  return (
    <Modal title={path} onClose={onClose} width={760}>
      <div style={{ padding: "20px 24px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={14} width="90%" />
            <Skeleton height={14} width="75%" />
            <Skeleton height={14} width="82%" />
          </div>
        ) : isError || !data ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("preview")}</p>
        ) : (
          <DocPreviewPane content={data.content} />
        )}
      </div>
    </Modal>
  );
}

// ---- DocRow ------------------------------------------------------------------

function DocRow({
  t,
  doc,
  attached,
  isFirst,
  isLast,
  isDragOver,
  isDragging,
  isSaving,
  onToggle,
  onPreview,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  t: T;
  doc: ContextDocument;
  attached: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const badge = categoryBadgeColor(doc.category);
  return (
    <div
      draggable={attached}
      onDragStart={attached ? onDragStart : undefined}
      onDragOver={attached ? onDragOver : undefined}
      onDragEnd={attached ? onDragEnd : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        background: isDragOver ? "var(--bg-hover)" : attached ? "var(--bg-surface)" : "var(--bg-primary)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        cursor: attached ? "grab" : "default",
        opacity: isDragging ? 0.5 : 1,
        transition: "background 80ms",
      }}
    >
      {attached ? (
        <Icon.Dot size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      ) : (
        <span style={{ width: 18, flexShrink: 0 }} />
      )}
      <Checkbox checked={attached} onChange={() => !isSaving && onToggle()} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="mono"
          style={{ fontWeight: attached ? 600 : 500, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={doc.path}
        >
          {doc.path}
        </div>
      </div>
      <Badge color={badge.color} bg={badge.bg} mono>
        {doc.category}
      </Badge>
      <span className="tnum" style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 64, textAlign: "right" }}>
        {t("tokenCountValue", { count: doc.token_count })}
      </span>
      <IconBtn icon="Eye" label={t("preview")} onClick={onPreview} />
      {attached && (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={onMoveUp}
            disabled={isFirst || isSaving}
            style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", opacity: isFirst ? 0.3 : 1, padding: 4, color: "var(--text-muted)" }}
            title={t("moveUp")}
            aria-label={t("moveUp")}
          >
            <Icon.ArrowUp size={14} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast || isSaving}
            style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", opacity: isLast ? 0.3 : 1, padding: 4, color: "var(--text-muted)" }}
            title={t("moveDown")}
            aria-label={t("moveDown")}
          >
            <Icon.ArrowDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---- SerializationPreview (AC-9) — unchanged from v1 ------------------------

function SerializationPreview({ t, linkedDocs, totalTokens }: { t: T; linkedDocs: ContextDocument[]; totalTokens: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "6px 2px", fontSize: 12, color: "var(--text-muted)" }}
      >
        <Icon.ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        {t("serializationPreview.toggle", { tokens: totalTokens })}
      </button>
      {open && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--code-bg)", padding: "10px 14px", marginTop: 6 }}>
          {linkedDocs.map((doc, idx) => (
            <div key={doc.path} className="mono" style={{ fontSize: 12, display: "flex", gap: 10, padding: "3px 0", color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent)" }}>{`spec-${idx}`}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.path}</span>
              <span className="tnum">{t("tokenCountValue", { count: doc.token_count })}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            {t("serializationPreview.total", { tokens: totalTokens })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ContextDocsList ---------------------------------------------------------

interface Props {
  /** A next-intl translator PRE-SCOPED to this list's own key group — pass
      useTranslations("agents.context") or useTranslations("skills.contextDocs"). */
  t: T;
  repoId: string | null;
  repoLabel: string;
  docs: ContextDocument[] | undefined;
  isLoadingDocs: boolean;
  linkedPaths: string[];
  isLoadingLinked: boolean;
  onSetLinked: (paths: string[]) => void;
  isSaving: boolean;
}

export function ContextDocsList({
  t,
  repoId,
  repoLabel,
  docs,
  isLoadingDocs,
  linkedPaths,
  isLoadingLinked,
  onSetLinked,
  isSaving,
}: Props) {
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const isLoading = isLoadingDocs || isLoadingLinked;

  const allDocs = docs ?? [];
  const byPath = new Map(allDocs.map((d) => [d.path, d]));
  const linkedSet = new Set(linkedPaths);

  const linkedDocs: ContextDocument[] = linkedPaths.map((p) => byPath.get(p) ?? fallbackDoc(p));
  const totalTokens = linkedDocs.reduce((sum, d) => sum + d.token_count, 0);

  const matches = (d: ContextDocument) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return d.path.toLowerCase().includes(q) || d.category.toLowerCase().includes(q);
  };

  // Attached docs first (persisted order), then unattached (discovery order).
  const linkedFiltered = linkedDocs.filter(matches);
  const unlinkedFiltered = allDocs.filter((d) => !linkedSet.has(d.path) && matches(d));
  const rows = [...linkedFiltered, ...unlinkedFiltered];

  const toggle = (path: string) => {
    if (linkedSet.has(path)) onSetLinked(linkedPaths.filter((p) => p !== path));
    else onSetLinked([...linkedPaths, path]);
  };

  const moveUp = (path: string) => {
    const idx = linkedPaths.indexOf(path);
    if (idx <= 0) return;
    const next = [...linkedPaths];
    const tmp = next[idx - 1]!;
    next[idx - 1] = next[idx]!;
    next[idx] = tmp;
    onSetLinked(next);
  };

  const moveDown = (path: string) => {
    const idx = linkedPaths.indexOf(path);
    if (idx < 0 || idx >= linkedPaths.length - 1) return;
    const next = [...linkedPaths];
    const tmp = next[idx]!;
    next[idx] = next[idx + 1]!;
    next[idx + 1] = tmp;
    onSetLinked(next);
  };

  const handleDragEnd = () => {
    if (dragging && dragOver && dragging !== dragOver) {
      const from = linkedPaths.indexOf(dragging);
      const to = linkedPaths.indexOf(dragOver);
      if (from >= 0 && to >= 0) {
        const next = [...linkedPaths];
        next.splice(from, 1);
        next.splice(to, 0, dragging);
        onSetLinked(next);
      }
    }
    setDragging(null);
    setDragOver(null);
  };

  if (!repoId) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noRepo")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: 28 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={48} style={{ marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("title")}</h2>
          <Badge color="var(--text-muted)">
            {t("attachedOfTotal", { attached: linkedPaths.length, total: allDocs.length })}
          </Badge>
          <Badge color="var(--text-secondary)" icon="GitBranch" mono>
            {repoLabel}
          </Badge>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("hint")}</p>
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Icon.Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("filterPlaceholder")}
          style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px 6px 28px", fontSize: 12, color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
        />
      </div>

      {allDocs.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>{t("noDocuments")}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>{t("noMatchingAvailable")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((doc) => {
            const attached = linkedSet.has(doc.path);
            const orderIdx = linkedPaths.indexOf(doc.path);
            return (
              <DocRow
                key={doc.path}
                t={t}
                doc={doc}
                attached={attached}
                isFirst={orderIdx === 0}
                isLast={orderIdx === linkedPaths.length - 1}
                isDragOver={dragOver === doc.path}
                isDragging={dragging === doc.path}
                isSaving={isSaving}
                onToggle={() => toggle(doc.path)}
                onPreview={() => setPreviewPath(doc.path)}
                onMoveUp={() => moveUp(doc.path)}
                onMoveDown={() => moveDown(doc.path)}
                onDragStart={() => setDragging(doc.path)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(doc.path);
                }}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </div>
      )}

      {linkedDocs.length > 0 && <SerializationPreview t={t} linkedDocs={linkedDocs} totalTokens={totalTokens} />}

      {previewPath && repoId && (
        <PreviewModalInline t={t} repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}
