/* ContextTab — the skill editor's `Context` tab (SPEC-01 US-3): attach the
   project's specs/docs/insights documents that every agent using this skill
   inherits (AC-18). Same autosave, client-held ordering and drag/keyboard
   reorder as the agent editor's Context tab (T9) — see
   `lib/hooks/context.ts`'s `useContextAutosave` for why the response body is
   never applied to what's rendered here (NFR-5).

   No context-window warning (AC-16): that budget is against an AGENT's model,
   and a skill has no model — the agent tab is where that warning belongs.

   Row order freezes on the FIRST RENDER of `ContextTabBody`, which only
   mounts once both queries have data — the same trick `SkillEditor` uses
   `key={skill.id:skill.version}` for elsewhere in this folder, done here by
   gating on data instead, so `useContextAutosave`'s `initialAcknowledged`
   (read once) is never seeded with an empty array before the real attachment
   set has loaded (AC-14). */
"use client";

import React, { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  EmptyState,
  ErrorState,
  Icon,
  IconBtn,
  Markdown,
  Modal,
  Skeleton,
} from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import type { ContextDocument } from "@/lib/types";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useContextAttachment,
  useContextAutosave,
  useContextDocuments,
  useContextPreview,
} from "@/lib/hooks/context";
import {
  DocumentRow,
  filterByPath,
  move,
  orderForDisplay,
  reconcileOrder,
  samePaths,
  shiftPath,
  TokenEstimate,
} from "@/components/context-docs";
import { buildSerializedPreview } from "./helpers";
import { s } from "./styles";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const docsQuery = useContextDocuments(repoId);
  const attachQuery = useContextAttachment("skill", skill.id, repoId);

  if (docsQuery.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          body={t("error", { message: errorMessage(docsQuery.error) })}
          onRetry={() => docsQuery.refetch()}
        />
      </div>
    );
  }
  if (attachQuery.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          body={t("error", { message: errorMessage(attachQuery.error) })}
          onRetry={() => attachQuery.refetch()}
        />
      </div>
    );
  }

  if (!docsQuery.data || !attachQuery.data) {
    return (
      <div style={s.wrap} role="status">
        <p style={s.loading}>{t("loading")}</p>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  return (
    <ContextTabBody
      skill={skill}
      repoId={repoId!}
      documents={docsQuery.data.documents}
      bounded={docsQuery.data.bounded}
      bound={docsQuery.data.bound}
      initialAttached={attachQuery.data.paths}
    />
  );
}

function ContextTabBody({
  skill,
  repoId,
  documents,
  bounded,
  bound,
  initialAttached,
}: {
  skill: Skill;
  repoId: string;
  documents: ContextDocument[];
  bounded: boolean;
  bound: number;
  initialAttached: string[];
}) {
  const t = useTranslations("context");
  const tSkills = useTranslations("skills");

  // Row order (linked and unlinked alike), remembered from the first edit
  // onward — `null` until then, which is when the seed order stops being
  // re-derived and rows stop moving under the user (AC-14).
  const [order, setOrder] = useState<string[] | null>(null);
  // The attached set, held client-side; never re-synced from a write's
  // response body (NFR-5).
  const [draft, setDraft] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Mirrors `client/INSIGHTS.md` 2026-08-16: dragover/drop read the dragged
  // path from a ref, because `useState` alone can still read the
  // pre-`dragstart` value inside those handlers.
  const dragRef = useRef<string | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);

  const autosave = useContextAutosave({
    ownerType: "skill",
    ownerId: skill.id,
    repoId,
    initialAcknowledged: initialAttached,
    onError: (message, revertTo) => {
      setSaveError(message);
      setDraft(revertTo);
    },
  });

  const attachedPaths = draft ?? initialAttached;

  const known = useMemo(() => new Set(documents.map((d) => d.path)), [documents]);
  const attachedSet = useMemo(
    () => new Set(attachedPaths.filter((p) => known.has(p))),
    [attachedPaths, known],
  );

  const seedOrder = useMemo(
    () => orderForDisplay(documents, attachedPaths).map((d) => d.path),
    [documents, attachedPaths],
  );
  const displayPaths = order ? reconcileOrder(order, seedOrder) : seedOrder;

  const byPath = useMemo(() => new Map(documents.map((d) => [d.path, d])), [documents]);
  const ordered = useMemo(
    () => displayPaths.flatMap((p) => (byPath.has(p) ? [byPath.get(p)!] : [])),
    [displayPaths, byPath],
  );
  const visible = filterByPath(ordered, filter);

  // Prompt order = row order, attached rows only — derived, so a re-checked
  // row returns to its own row's position rather than the end of the list.
  const effectivePaths = useMemo(
    () => displayPaths.filter((p) => attachedSet.has(p)),
    [displayPaths, attachedSet],
  );

  const totalTokens = useMemo(
    () =>
      effectivePaths.reduce((sum, p) => sum + (byPath.get(p)?.token_estimate ?? 0), 0),
    [effectivePaths, byPath],
  );

  const serializedPreview = useMemo(() => buildSerializedPreview(effectivePaths), [effectivePaths]);

  const commit = (nextOrder: string[], nextAttached: string[]) => {
    setOrder(nextOrder);
    setDraft(nextAttached);
    setSaveError(null);
    autosave.save(nextAttached);
  };

  const toggle = (path: string) => {
    const next = new Set(attachedSet);
    if (!next.delete(path)) next.add(path);
    // Same row order, different membership — the row stays exactly where it is.
    commit(displayPaths, displayPaths.filter((p) => next.has(p)));
  };

  /** Drop `fromPath` onto `toPath`'s row, attached or not — every row is a
      valid drop target (`client/INSIGHTS.md` 2026-08-17). */
  const reorder = (fromPath: string, toPath: string) => {
    const nextOrder = move(displayPaths, displayPaths.indexOf(fromPath), displayPaths.indexOf(toPath));
    if (nextOrder === displayPaths) return; // `move` is total: a no-op returns the input
    const nextAttached = nextOrder.filter((p) => attachedSet.has(p));
    // Stepping past an unattached row moves the row without changing the
    // prompt — remember the new row order, but don't spend a write on it.
    if (samePaths(nextAttached, effectivePaths)) {
      setOrder(nextOrder);
      return;
    }
    commit(nextOrder, nextAttached);
  };

  /** Keyboard equivalent of a drag (REQ-36) — `shiftPath` steps the row past
      its immediate neighbour in the FULL row list, the same reorder a pointer
      drop onto that neighbour would perform, so the two paths can never
      diverge in what order they produce. */
  const shift = (path: string, delta: -1 | 1) => {
    const nextOrder = shiftPath(displayPaths, path, delta);
    if (nextOrder === displayPaths) return;
    const nextAttached = nextOrder.filter((p) => attachedSet.has(p));
    if (samePaths(nextAttached, effectivePaths)) {
      setOrder(nextOrder);
      return;
    }
    commit(nextOrder, nextAttached);
  };

  const beginDrag = (e: React.DragEvent<HTMLElement>, path: string) => {
    dragRef.current = path;
    setDragPath(path);
    const dt = e.dataTransfer;
    if (!dt) return;
    // Not optional: Firefox aborts a drag whose `dragstart` wrote nothing.
    dt.setData("text/plain", path);
    dt.effectAllowed = "move";
    const row = e.currentTarget.closest("li");
    if (row && dt.setDragImage) dt.setDragImage(row, 16, row.clientHeight / 2);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragPath(null);
    setOverPath(null);
  };

  const onDropRow = (targetPath: string) => {
    const dragged = dragRef.current;
    endDrag();
    if (dragged) reorder(dragged, targetPath);
  };

  const previewQuery = useContextPreview(repoId, previewPath);
  const previewDoc = previewPath ? byPath.get(previewPath) : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>{t("heading.skill", { n: effectivePaths.length })}</h2>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} aria-hidden="true" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterPlaceholder")}
            aria-label={t("filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.subtitle}>{t("skillSubtitle")}</p>
      <p style={s.hint}>{t("orderHint")}</p>
      {bounded && <p style={s.bounded}>{t("bounded", { bound })}</p>}
      {saveError && (
        <p role="alert" aria-live="polite" style={s.saveError}>
          {t("saveFailed", { message: saveError })}
        </p>
      )}

      {documents.length === 0 ? (
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
      ) : (
        <>
          {visible.length === 0 && (
            <p style={s.noMatch}>{tSkills("editor.context.noMatch")}</p>
          )}
          <ul style={s.list}>
            {visible.map((doc) => {
              const position = effectivePaths.indexOf(doc.path);
              const attached = position !== -1;
              const gripAriaLabel = attached
                ? tSkills("editor.context.reorder", {
                    name: doc.path,
                    position: position + 1,
                    total: effectivePaths.length,
                  })
                : tSkills("editor.context.reorderUnattached", { name: doc.path });

              return (
                <DocumentRow
                  key={doc.path}
                  document={doc}
                  checked={attachedSet.has(doc.path)}
                  onToggle={doc.oversized ? undefined : () => toggle(doc.path)}
                  drag={{
                    dragging: dragPath === doc.path,
                    dropTarget: overPath === doc.path && dragPath !== doc.path,
                    onDragStart: (e) => beginDrag(e, doc.path),
                    onDragOver: (e) => {
                      // EVERY row must preventDefault first — a target that
                      // skips it refuses the drop silently.
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      if (doc.path !== overPath) setOverPath(doc.path);
                    },
                    onDragLeave: () => setOverPath((cur) => (cur === doc.path ? null : cur)),
                    onDrop: (e) => {
                      e.preventDefault();
                      onDropRow(doc.path);
                    },
                    onDragEnd: endDrag,
                    onKeyReorder: (delta) => shift(doc.path, delta),
                    gripAriaLabel,
                  }}
                  previewAction={
                    <IconBtn
                      icon="Eye"
                      label={t("previewAriaLabel", { name: doc.path })}
                      onClick={() => setPreviewPath(doc.path)}
                    />
                  }
                />
              );
            })}
          </ul>
        </>
      )}

      <div style={s.footer}>
        <TokenEstimate count={totalTokens} />
        <span style={s.footerNote}>{t("injectedNote")}</span>
      </div>

      <div style={s.serializeBox}>
        <div style={s.serializeLabel}>{t("serializesAs")}</div>
        <pre style={s.serializePre}>{serializedPreview}</pre>
      </div>

      {previewPath && (
        <Modal title={previewDoc?.path ?? previewPath} onClose={() => setPreviewPath(null)}>
          {previewQuery.isLoading && <Skeleton height={200} />}
          {previewQuery.isError && (
            <ErrorState
              body={errorMessage(previewQuery.error)}
              onRetry={() => previewQuery.refetch()}
            />
          )}
          {previewQuery.data &&
            (previewQuery.data.content?.trim() ? (
              <div style={{ padding: "20px 24px" }}>
                <Markdown>{previewQuery.data.content}</Markdown>
              </div>
            ) : (
              <p style={s.previewEmpty}>{tSkills("editor.preview.empty")}</p>
            ))}
        </Modal>
      )}
    </div>
  );
}
