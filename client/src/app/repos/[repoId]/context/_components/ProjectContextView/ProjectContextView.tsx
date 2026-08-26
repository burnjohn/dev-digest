/* ProjectContextView — /repos/:repoId/context (SPEC-01, T8).

   A full-height two-pane split following `docs/mockups/Context Folder 1.png`.
   The LEFT pane is nothing but a scrollable list of repository-relative paths,
   with the upload/refresh toolbar above it and a status footer pinned below;
   the RIGHT pane renders the selected document, with its metadata in a header
   strip. Selecting a row previews it — the row IS the preview control, so
   there is no separate Preview button on this surface.

   Owner decision 2026-08-26: the type badge (AC-1), the token estimate
   (AC-6), the `Used by N agents` chip (AC-7) and the oversized marker (AC-8)
   moved OFF each row and into the right pane's header, for the selected
   document only. SPEC-01 and `docs/plans/07-project-context.md` were amended in
   the same change. Both `Context` tabs still render the full `DocumentRow`
   anatomy — `components/context-docs` is untouched, and this page simply stops
   using `DocumentRow`.

   This page never attaches anything to an agent or skill, so REQ-8's "attach
   affordance disabled" half has nothing to act on here; the "visibly marked"
   half is `OversizedMarker` in the preview header.

   `client/INSIGHTS.md` 2026-08-25 — `api.get<T>()` is a cast with no runtime
   parse, so a malformed payload throws mid-render rather than tripping a
   hook's `isError` branch. `lib/hooks/context.ts`'s queries already parse
   their payload with the matching Zod schema inside `queryFn`, which covers
   the common case; this view is additionally wrapped in `ErrorBoundary` per
   that same insight, in case some other render-time throw slips through. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, IconBtn, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { RepoNotFound } from "@/components/repo-not-found";
import { OversizedMarker, TokenEstimate, TypeBadge } from "@/components/context-docs";
import {
  useContextDocuments,
  useContextPreview,
  useUploadContextDocument,
} from "@/lib/hooks/context";
import { relativeTime } from "@/lib/format";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import type { ContextDocument } from "@/lib/types";
import { FRESHNESS_TICK_MS, SKELETON_ROWS } from "./constants";
import { errorMessage, sortByPath, totalTokens } from "./helpers";
import { s } from "./styles";

/** One row in the left pane: a file icon and the whole repository-relative
    path, ellipsized. Hover lives in local state because the row is styled
    inline — the same pattern `vendor/ui/primitives/IconBtn` uses. */
function DocumentListItem({
  document,
  selected,
  onSelect,
}: {
  document: ContextDocument;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("context");
  const [hover, setHover] = React.useState(false);

  return (
    <li>
      <button
        type="button"
        // Contains the row's visible text, so WCAG 2.5.3 (label in name) holds
        // while still naming what activating the row does (REQ-43/NFR-7).
        aria-label={t("previewAriaLabel", { name: document.path })}
        aria-current={selected || undefined}
        onClick={onSelect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={s.rowBtn(selected, hover)}
      >
        <Icon.FileText size={13} aria-hidden="true" style={s.rowIcon} />
        <span className="mono" style={s.rowPath}>
          {document.path}
        </span>
      </button>
    </li>
  );
}

/** The right pane's body once a document is selected — its own query, its own
    loading/error branches, kept out of the parent component so a slow or
    failing preview never blocks the list from rendering. */
function PreviewContent({ repoId, path }: { repoId: string; path: string }) {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const { data, isLoading, isError, error, refetch } = useContextPreview(repoId, path);

  if (isLoading) {
    return <p style={s.previewPlaceholder}>{t("loading")}</p>;
  }
  if (isError) {
    return (
      <ErrorState
        title={t("error", { message: errorMessage(error) ?? tCommon("states.error") })}
        onRetry={() => refetch()}
      />
    );
  }
  return <Markdown>{data?.content ?? ""}</Markdown>;
}

export function ProjectContextView() {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useContextDocuments(repoId);
  const upload = useUploadContextDocument();
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // `relativeTime` reads `Date.now()` at render, so without a tick the footer
  // would freeze at "refreshed just now" until some unrelated state change
  // re-rendered the view. One minute is the resolution `relativeTime` itself
  // has ("5m", "3h", "2d"), so a faster tick would buy nothing.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const documents = sortByPath(data?.documents ?? []);
  const total = data?.total ?? documents.length;
  const bounded = data?.bounded ?? false;
  const bound = data?.bound ?? 0;
  const selected = documents.find((d) => d.path === selectedPath) ?? null;

  const fullName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: fullName, mono: true }, { label: t("title") }];

  // `relativeTime` yields "now" | "5m" | "3h" | "2d"; only the last three read
  // as an elapsed span, so "now" gets its own phrasing rather than "now ago"
  // (the guard `ConventionsView` already established for its scan line).
  // Derived on every render rather than memoised — the tick above is what makes
  // it age, and a memo keyed on `dataUpdatedAt` would never see the tick.
  const refreshed = (() => {
    if (!dataUpdatedAt) return null;
    const rel = relativeTime(new Date(dataUpdatedAt).toISOString());
    return rel === "now" ? t("footerRefreshedNow") : t("footerRefreshed", { rel });
  })();

  const handleFile = async (file: File) => {
    if (!repoId) return;
    try {
      const content = await file.text();
      await upload.mutateAsync({ repoId, filename: file.name, content });
    } catch (err) {
      toast.error(errorMessage(err) ?? tCommon("states.error"));
    }
  };

  // Render-time-throw containment (client/INSIGHTS.md 2026-08-25): clears when
  // the repo or the selected document changes, so a bad payload does not
  // follow the user around after they navigate away from it.
  const boundaryFallback = (reset: () => void) => (
    <EmptyState
      icon="AlertTriangle"
      title={tCommon("states.error")}
      cta={tCommon("actions.retry")}
      onCta={reset}
    />
  );

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <RepoNotFound />
        </div>
      </AppShell>
    );
  }

  const usedByLabel = (doc: ContextDocument) =>
    doc.used_by_disabled_skill_only > 0
      ? `${t("usedBy", { count: doc.used_by_agents })} ${t("usedByDisabledSkill", {
          count: doc.used_by_disabled_skill_only,
        })}`
      : t("usedBy", { count: doc.used_by_agents });

  // The right pane in every state EXCEPT "a document is selected". The list
  // pane keeps its toolbar in all of them, which is why the two-pane frame is
  // rendered unconditionally rather than replaced by each branch.
  const previewFallback = isError ? (
    <div style={s.centered}>
      <ErrorState
        title={t("error", { message: errorMessage(error) ?? tCommon("states.error") })}
        onRetry={() => refetch()}
      />
    </div>
  ) : !isLoading && documents.length === 0 ? (
    <div style={s.centered}>
      <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
    </div>
  ) : (
    <div style={s.previewBody}>
      <p style={s.previewPlaceholder}>{tCommon("states.empty")}</p>
    </div>
  );

  return (
    <AppShell crumb={crumb}>
      <ErrorBoundary resetKeys={[repoId, selectedPath]} fallback={boundaryFallback}>
        <div style={s.page}>
          <div style={s.listPane}>
            <div style={s.listHeader}>
              <span style={s.eyebrow}>{t("title")}</span>
              <div style={s.toolbar}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    // Reset so picking the SAME file again still fires onChange.
                    e.target.value = "";
                  }}
                />
                <IconBtn
                  icon="Upload"
                  label={t("toolbar.upload")}
                  disabled={upload.isPending}
                  onClick={() => fileInputRef.current?.click()}
                />
                <IconBtn icon="RefreshCw" label={t("toolbar.refresh")} onClick={() => refetch()} />
              </div>
            </div>

            {isLoading ? (
              // Outside the <ul>: a list may only contain <li>, and these are
              // skeletons, not rows.
              <div style={s.loadingStack} role="status">
                <span style={s.loadingLabel}>{t("loading")}</span>
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <Skeleton key={i} height={28} />
                ))}
              </div>
            ) : (
              <ul style={s.list}>
                {documents.map((doc) => (
                  <DocumentListItem
                    key={doc.path}
                    document={doc}
                    selected={selectedPath === doc.path}
                    onSelect={() => setSelectedPath(doc.path)}
                  />
                ))}
              </ul>
            )}

            <div style={s.footer}>
              <span>
                {t("footerCount", { count: total })}
                {documents.length > 0 && ` · ${t("tokenEstimate", { count: totalTokens(documents) })}`}
                {refreshed && ` · ${refreshed}`}
              </span>
              {bounded && <div style={s.bounded}>{t("bounded", { bound })}</div>}
            </div>
          </div>

          <div style={s.previewPane}>
            {selected ? (
              <>
                <div style={s.previewHeader}>
                  <span className="mono" style={s.previewPath}>
                    {selected.path}
                  </span>
                  <span style={s.previewMeta}>
                    <TypeBadge type={selected.type} />
                    <TokenEstimate count={selected.token_estimate} />
                    <Badge>{usedByLabel(selected)}</Badge>
                    {selected.oversized && <OversizedMarker />}
                  </span>
                </div>
                <div style={s.previewBody}>
                  <PreviewContent repoId={repoId} path={selected.path} />
                </div>
              </>
            ) : (
              previewFallback
            )}
          </div>
        </div>
      </ErrorBoundary>
    </AppShell>
  );
}
