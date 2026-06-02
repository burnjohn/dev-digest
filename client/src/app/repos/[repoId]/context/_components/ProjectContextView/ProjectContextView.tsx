/* Project Context — /repos/:repoId/context (A3, L05).
   Spec list + coverage % + Re-index with PERCENTAGE progress bar (not a spinner,
   §11). ?path= selects a spec, ?mode=preview|edit toggles the editor. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, Card, Icon, PercentProgress, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import { useSpecs, useIndexStatus, useReindex } from "../../../../../../lib/hooks/context";
import { type SpecMode } from "./constants";
import { isIndexing, kb, progressColor, shortSpecPath } from "./helpers";
import { SpecEditor } from "./_components/SpecEditor";
import { s } from "./styles";

/** Project Context page body (route: /repos/:repoId/context). */
export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  const path = search.get("path");
  const mode = (search.get("mode") as SpecMode | null) ?? "preview";

  const { data: specs, isLoading, isError, error } = useSpecs(repoId);
  const reindex = useReindex(repoId);
  // poll status while a reindex is running (status not done/idle/error)
  const [polling, setPolling] = React.useState(false);
  const { data: status } = useIndexStatus(repoId, polling);

  React.useEffect(() => {
    if (!status) return;
    setPolling(isIndexing(status.status));
  }, [status?.status]);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("title") },
  ];

  const select = (p: string | null, m?: SpecMode) => {
    const sp = new URLSearchParams(search.toString());
    if (p) sp.set("path", p);
    else sp.delete("path");
    if (m) sp.set("mode", m);
    router.replace(`/repos/${repoId}/context${sp.toString() ? `?${sp}` : ""}`);
  };

  const onReindex = () => {
    setPolling(true);
    reindex.mutate();
  };

  const indexing = isIndexing(status?.status);
  const specList = specs ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>{t("title")}</h1>
          {status?.chunks_indexed != null && (
            <Badge mono icon="Database">
              {t("chunks", { count: status.chunks_indexed })}
            </Badge>
          )}
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onReindex} disabled={reindex.isPending || indexing}>
            {indexing ? t("indexing") : t("reindex")}
          </Button>
        </div>

        {/* coverage indicator + progress */}
        {status && (
          <div style={s.progressWrap}>
            <PercentProgress
              value={status.pct}
              label={status.message ?? t("indexStatus", { status: status.status })}
              color={progressColor(status.status)}
            />
          </div>
        )}

        {isLoading ? (
          <Skeleton height={200} />
        ) : isError ? (
          <ErrorState title={t("loadError")} body={(error as Error)?.message ?? ""} />
        ) : specList.length === 0 ? (
          <EmptyState icon="Folder" title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <div style={s.layout(!!path)}>
            <div style={s.specList}>
              {specList.map((spec) => (
                <Card
                  key={spec.path}
                  hover
                  onClick={() => select(spec.path, "preview")}
                  style={spec.path === path ? s.specCardSelected : s.specCard}
                >
                  <div style={s.specRow}>
                    <Icon.FileText size={14} style={s.specIcon} />
                    <span className="mono" style={s.specPath}>
                      {shortSpecPath(spec.path)}
                    </span>
                    {spec.size != null && (
                      <span style={s.specSize} className="tnum">
                        {t("kb", { kb: kb(spec.size) })}
                      </span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
            {path && <SpecEditor repoId={repoId} path={path} mode={mode} onMode={(m) => select(path, m)} />}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default ProjectContextView;
