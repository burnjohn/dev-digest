/* ContextTab — the agent editor's `Context` tab: attach/detach and reorder the
   Project Context documents (SPEC-01) an agent reads under the `## Project
   context` prompt heading.

   There is no Save button: every toggle and every drop goes straight through
   `useContextAutosave` (lib/hooks/context.ts, T6), a debounced replace-set
   write. The mutation's response is never applied back to the rendered rows
   (NFR-5) — this component goes on rendering the attached set and row order it
   already holds, which is what keeps REQ-14 true across a round trip; the ONLY
   state a failed write changes is reverting the attached set to the last
   acknowledged one (REQ-35).

   Row order mirrors `SkillsTab` exactly (client/INSIGHTS.md 2026-08-16): frozen
   in state at the first edit, reconciled against the live document set on every
   render via `reconcileOrder` (components/context-docs/helpers.ts, T6) rather
   than re-derived from the attached set — a toggle must never move the row it
   is on (REQ-14). Prompt order is the derived thing: `displayPaths` filtered to
   attached paths.

   Agents carry no `repo_id` of their own (`@devdigest/shared`'s `Agent`
   contract has none) and this route has no `:repoId` segment, so the tab reads
   the workspace's globally active repo via `useActiveRepo()` (lib/repo-context,
   the same source `RepoSwitcher` writes) rather than inventing a second repo
   picker. See the report's "Notes for the integrator" for this call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  DocumentRow,
  TokenEstimate,
  filterByPath,
  move,
  orderForDisplay,
  reconcileOrder,
  samePaths,
  shiftPath,
  splitDocPath,
} from "@/components/context-docs";
import type { ContextDocument } from "@/lib/types";
import {
  useContextAttachment,
  useContextAutosave,
  useContextDocuments,
  useContextPreview,
} from "@/lib/hooks/context";
import { useProviderModels } from "@/lib/hooks/agents";
import { useActiveRepo } from "@/lib/repo-context";
import { isOverWindowThreshold, sumAttachedTokens } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();

  const docsQuery = useContextDocuments(repoId);
  const attachQuery = useContextAttachment("agent", agent.id, repoId);

  if (docsQuery.isError || attachQuery.isError) {
    const err = docsQuery.error ?? attachQuery.error;
    const message = err instanceof Error ? err.message : "";
    return (
      <div style={s.wrap}>
        <ErrorState
          body={t("error", { message })}
          onRetry={() => {
            docsQuery.refetch();
            attachQuery.refetch();
          }}
        />
      </div>
    );
  }

  // Gate on DATA presence, not `isLoading` — a query stays disabled (and so
  // never "loading") until `repoId` resolves, so this is what actually keeps
  // the interactive body from mounting before there is a real initial
  // attached set for `useContextAutosave` to seed itself from.
  if (!docsQuery.data || !attachQuery.data) {
    return (
      <div style={s.wrap}>
        <p role="status" style={s.hint}>
          {t("loading")}
        </p>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if (docsQuery.data.documents.length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
      </div>
    );
  }

  return (
    <ContextTabBody
      // Remount on repo switch too — a stale frozen `order`/`attached` from a
      // DIFFERENT repo must never survive into this one.
      key={repoId}
      agent={agent}
      repoId={repoId!}
      docs={docsQuery.data.documents}
      initialAttached={attachQuery.data.paths}
    />
  );
}

function ContextTabBody({
  agent,
  repoId,
  docs,
  initialAttached,
}: {
  agent: Agent;
  repoId: string;
  docs: ContextDocument[];
  initialAttached: string[];
}) {
  const t = useTranslations("context");
  const ta = useTranslations("agents");

  const [attached, setAttached] = React.useState<Set<string>>(() => new Set(initialAttached));
  // Remembered ROW order (attached and unattached alike). `null` until the
  // first edit — see the file header.
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Drag state lives in React, not `dataTransfer`; the dragged path is
  // mirrored into a ref because `dragover`/`drop` read it, and a handler
  // closure captured before the `dragstart` re-render flushed would otherwise
  // see `null` (client/INSIGHTS.md 2026-08-16).
  const dragRef = React.useRef<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const autosave = useContextAutosave({
    ownerType: "agent",
    ownerId: agent.id,
    repoId,
    initialAcknowledged: initialAttached,
    onError: (message, revertTo) => {
      setSaveError(message);
      // Revert the ATTACHED state only — never `order`. REQ-14 forbids a
      // resolved write (success or failure alike) from moving a row.
      setAttached(new Set(revertTo));
    },
  });

  // Drop attached paths for documents that vanished, so a stale attached set
  // can never post a dead path.
  const knownPaths = React.useMemo(() => new Set(docs.map((d) => d.path)), [docs]);
  const attachedLive = React.useMemo(
    () => new Set([...attached].filter((p) => knownPaths.has(p))),
    [attached, knownPaths],
  );

  // Row order: the remembered one once the user has edited, else the seed.
  const displayPaths = React.useMemo(() => {
    const seed = orderForDisplay(docs, [...attachedLive]).map((d) => d.path);
    return order ? reconcileOrder(order, seed) : seed;
  }, [docs, attachedLive, order]);

  const byPath = React.useMemo(() => new Map(docs.map((d) => [d.path, d])), [docs]);
  const ordered = React.useMemo(
    () => displayPaths.flatMap((p) => (byPath.has(p) ? [byPath.get(p)!] : [])),
    [displayPaths, byPath],
  );
  const visible = filterByPath(ordered, filter);

  // Prompt order = row order, attached rows only.
  const effectivePaths = React.useMemo(
    () => displayPaths.filter((p) => attachedLive.has(p)),
    [displayPaths, attachedLive],
  );

  const attachedTokens = sumAttachedTokens(docs, attachedLive);

  const { data: models } = useProviderModels(agent.provider);
  const contextLength = models?.find((m) => m.id === agent.model)?.contextLength ?? null;
  const showWarning = contextLength != null && isOverWindowThreshold(attachedTokens, contextLength);

  /** Persist a new ordered set, with the row order it was computed against. */
  const commit = (nextOrder: string[], nextAttached: string[]) => {
    setOrder(nextOrder);
    setAttached(new Set(nextAttached));
    setSaveError(null);
    autosave.save(nextAttached);
  };

  const toggle = (path: string) => {
    const next = new Set(attachedLive);
    if (!next.delete(path)) next.add(path);
    // Same row order, different membership — the row stays exactly where it is.
    commit(displayPaths, displayPaths.filter((p) => next.has(p)));
  };

  /** Drop `fromPath` onto `toPath`'s ROW, attached or not — every row is a
      valid drop target (client/INSIGHTS.md 2026-08-17). */
  const reorder = (fromPath: string, toPath: string) => {
    const nextOrder = move(displayPaths, displayPaths.indexOf(fromPath), displayPaths.indexOf(toPath));
    if (nextOrder === displayPaths) return; // `move` is total: a no-op returns the input
    const nextAttached = nextOrder.filter((p) => attachedLive.has(p));
    // Stepping past an unattached row moves the row without changing the
    // prompt — remember the new row order, but don't spend a write on it.
    if (samePaths(nextAttached, effectivePaths)) {
      setOrder(nextOrder);
      return;
    }
    commit(nextOrder, nextAttached);
  };

  /** Keyboard equivalent of a drag: step one prompt slot up/down, over
      unattached rows, landing on the identical order a drag would (REQ-36). */
  const shift = (path: string, delta: -1 | 1) => {
    const nextEffective = shiftPath(effectivePaths, path, delta);
    if (nextEffective === effectivePaths) return; // boundary — shiftPath is total
    const at = effectivePaths.indexOf(path);
    const target = effectivePaths[at + delta]!;
    reorder(path, target);
  };

  const beginDrag = (e: React.DragEvent<HTMLElement>, path: string) => {
    dragRef.current = path;
    setDragId(path);
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData("text/plain", path);
    dt.effectAllowed = "move";
    const row = e.currentTarget.closest("li");
    if (row && dt.setDragImage) dt.setDragImage(row, 16, row.clientHeight / 2);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  const onDrop = (targetPath: string) => {
    const dragged = dragRef.current;
    endDrag();
    if (dragged) reorder(dragged, targetPath);
  };

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>{t("heading.agent", { n: effectivePaths.length, total: docs.length })}</h2>
        {autosave.isSaving && (
          <span role="status" style={s.status}>
            {ta("context.saving")}
          </span>
        )}
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

      <p style={s.hint}>{t("orderHint")}</p>

      {saveError && (
        <p role="status" aria-live="polite" style={s.saveError}>
          {t("saveFailed", { message: saveError })}
        </p>
      )}

      {showWarning && (
        <p role="status" aria-live="polite" style={s.warning}>
          {t("overWindowWarning", { tokens: attachedTokens, window: contextLength })}
        </p>
      )}

      <ul style={s.list}>
        {visible.map((doc) => {
          const position = effectivePaths.indexOf(doc.path);
          const isAttached = position !== -1;
          const { filename } = splitDocPath(doc.path);
          return (
            <DocumentRow
              key={doc.path}
              document={doc}
              // AC-8 / T6 note: `vendor/ui`'s `Checkbox` has no `disabled` prop,
              // so an oversized document is kept unattachable by never wiring
              // its `onToggle` (its checked state, if it was attached before it
              // grew past the bound, still renders truthfully) — not by editing
              // the primitive.
              checked={isAttached}
              onToggle={doc.oversized ? undefined : () => toggle(doc.path)}
              checkboxAriaLabel={filename}
              drag={{
                dragging: dragId === doc.path,
                dropTarget: overId === doc.path && dragId !== doc.path,
                onDragStart: (e) => beginDrag(e, doc.path),
                onDragOver: (e) => {
                  if (!dragRef.current) return;
                  // EVERY row must preventDefault, or the drop is refused
                  // silently (client/INSIGHTS.md 2026-08-17).
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  if (doc.path !== overId) setOverId(doc.path);
                },
                onDragLeave: () => setOverId((cur) => (cur === doc.path ? null : cur)),
                onDrop: (e) => {
                  e.preventDefault();
                  onDrop(doc.path);
                },
                onDragEnd: endDrag,
                onKeyReorder: (delta) => shift(doc.path, delta),
                gripAriaLabel: isAttached
                  ? ta("context.reorder", { name: filename, position: position + 1, total: effectivePaths.length })
                  : ta("context.reorderUnattached", { name: filename }),
              }}
              previewAction={
                <Button
                  kind="tertiary"
                  size="sm"
                  onClick={() => setPreviewPath(doc.path)}
                  aria-label={t("previewAriaLabel", { name: filename })}
                >
                  {t("preview")}
                </Button>
              }
            />
          );
        })}
      </ul>

      <div style={s.footer}>
        <TokenEstimate count={attachedTokens} />
        <span style={s.injectedNote}>{t("injectedNote")}</span>
      </div>

      {previewPath && (
        <PreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}

function PreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useContextPreview(repoId, path);
  return (
    <Modal title={path} onClose={onClose}>
      {isLoading && <Skeleton height={160} />}
      {isError && <ErrorState body={t("error", { message: "" })} />}
      {data && (
        <>
          <div style={s.previewLabel}>{t("serializesAs")}</div>
          <pre style={s.previewContent}>{data.content}</pre>
        </>
      )}
    </Modal>
  );
}
