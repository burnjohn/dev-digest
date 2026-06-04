/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + Lethal-Trifecta surfacing + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Smart Diff viewer (grouped files, finding markers, split nudge) in Files tab
   - Intent layer (in/out-of-scope chips)
   Mount points preserved for A3 (PR Brief) and A4 (Conformance link).
   Tab/drawer state lives in query (?tab, ?finding, ?compose, ?trace). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Icon,
  Avatar,
  Badge,
  Button,
  Chip,
  Tabs,
  Skeleton,
  EmptyState,
  ErrorState,
  SectionLabel,
} from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { DiffViewer } from "../../../../../components/diff-viewer";
import { SmartDiffViewer } from "./_components/SmartDiffViewer";
import { FindingsPanel } from "./_components/FindingsPanel";
import { VerdictBanner } from "./_components/VerdictBanner";
import { RunReviewDropdown } from "./_components/RunReviewDropdown";
import { RunStatus } from "./_components/RunStatus";
import PrBriefCard from "./_components/PrBriefCard";
import WhyTimelineDrawer from "./_components/WhyTimelineDrawer";
import ConformanceReport from "./conformance/_components/ConformanceReport";
import ComposeReviewDrawer from "./_components/ComposeReviewDrawer";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { usePrReviews, usePrIntent, useSmartDiff } from "../../../../../lib/hooks/reviews";
import { useActiveRepo } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import type { FindingRecord, Verdict } from "@devdigest/shared";

/** Mount point a feature agent (A3/A4) replaces with its real screen. */
function MountPoint({ title, owner, icon = "Boxes" }: { title: string; owner: string; icon?: any }) {
  return (
    <div style={{ border: "1px dashed var(--border-strong)", borderRadius: 8, background: "var(--bg-surface)" }}>
      <EmptyState
        icon={icon}
        title={title}
        body={`Mount point for ${owner}. The PR-detail shell (header, tabs, routing, data) is wired by F2/A2 — ${owner} renders here.`}
      />
    </div>
  );
}

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews } = usePrReviews(prId);
  const { data: intent } = usePrIntent(prId);
  const { data: smartDiff } = useSmartDiff(prId);

  const [liveRunIds, setLiveRunIds] = React.useState<string[]>([]);

  const tab = search.get("tab") ?? "overview";
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);

  // Drawer state from query (?compose, ?trace=runId, ?why=file:line) — deep-linkable.
  const composeOpen = search.get("compose") != null;
  const traceRunId = search.get("trace");
  const whyParam = search.get("why");
  const whyLocation = React.useMemo(() => {
    if (!whyParam) return null;
    const i = whyParam.lastIndexOf(":");
    if (i < 0) return null;
    const file = whyParam.slice(0, i);
    const line = Number(whyParam.slice(i + 1));
    return file && Number.isFinite(line) ? { file, line } : null;
  }, [whyParam]);

  // Latest review = most recent (reviews come newest-first); aggregate findings.
  const latestReview = reviews?.[0];
  const allFindings: FindingRecord[] = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;
  const blockers = allFindings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn’t load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border)",
          padding: "18px 32px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="mono" style={{ fontSize: 18, color: "var(--text-muted)", fontWeight: 500 }}>
                #{pr.number}
              </span>
              {pr.title}
            </h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 10,
                marginBottom: 14,
                fontSize: 13,
                color: "var(--text-secondary)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Avatar name={pr.author} size={17} />
                {pr.author}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={{ fontSize: 12 }}>
                  {pr.branch}
                </span>
                <Icon.ArrowRight size={11} />
                <span className="mono" style={{ fontSize: 12 }}>
                  {pr.base}
                </span>
              </span>
              <span className="mono tnum">
                <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
                <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
              </span>
              <Badge color="var(--warn)" bg="var(--warn-bg)" dot>
                {pr.status}
              </Badge>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <Button kind="ghost" size="sm" icon="ExternalLink">
              View on GitHub
            </Button>
            {prId && (
              <Button kind="ghost" size="sm" icon="MessageSquare" onClick={() => setParam("compose", "1")}>
                Compose Review
              </Button>
            )}
            {prId && (
              <RunReviewDropdown
                prId={prId}
                onRunsStarted={(ids) => {
                  setLiveRunIds(ids);
                  setTab("findings");
                }}
              />
            )}
          </div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          pad="0"
          tabs={[
            { key: "overview", label: "Overview", icon: "FileText" },
            { key: "findings", label: "Findings", icon: "AlertOctagon", count: findingsCount || undefined },
            { key: "diff", label: "Files changed", icon: "Code", count: pr.files_count },
            { key: "conformance", label: "Conformance", icon: "ListChecks" },
          ]}
        />
      </div>

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <>
            <section>
              <SectionLabel icon="FileText">PR Brief</SectionLabel>
              {prId && (
                <PrBriefCard
                  prId={prId}
                  onWhy={(file, line) => setParam("why", `${file}:${line}`)}
                />
              )}
            </section>
            {pr.body && (
              <section>
                <SectionLabel icon="MessageSquare">Description</SectionLabel>
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elevated)",
                    padding: 18,
                    fontSize: 14,
                    color: "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.55,
                  }}
                >
                  {pr.body}
                </div>
              </section>
            )}
          </>
        )}

        {tab === "findings" && (
          <section>
            {liveRunIds.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionLabel
                  icon="Sparkles"
                  right={
                    <Button kind="ghost" size="sm" icon="FileText" onClick={() => setParam("trace", liveRunIds[0]!)}>
                      Open run trace
                    </Button>
                  }
                >
                  Live review
                </SectionLabel>
                <RunStatus runIds={liveRunIds} onDone={() => refetch()} />
              </div>
            )}

            {latestReview?.verdict && (
              <div style={{ marginBottom: 18 }}>
                <VerdictBanner
                  verdict={latestReview.verdict as Verdict}
                  summary={latestReview.summary}
                  score={latestReview.score}
                  findingsCount={findingsCount}
                  blockers={blockers}
                  agentName={latestReview.agent_name}
                />
              </div>
            )}

            {lethalTrifecta.length > 0 && (
              <div
                style={{
                  marginBottom: 18,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--crit)",
                  background: "var(--crit-bg)",
                }}
              >
                <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--crit)" }}>
                  Lethal Trifecta detected
                </span>
                <Badge color="var(--crit)" bg="transparent">
                  {lethalTrifecta.length} finding(s)
                </Badge>
              </div>
            )}

            <SectionLabel
              icon="AlertOctagon"
              right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>sorted by severity · j/k to navigate</span>}
            >
              Findings
            </SectionLabel>
            {findingsCount === 0 && liveRunIds.length === 0 ? (
              <EmptyState
                icon="Sparkles"
                title="No findings yet"
                body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
              />
            ) : (
              prId && <FindingsPanel findings={allFindings} prId={prId} />
            )}
          </section>
        )}

        {tab === "diff" && (
          <section>
            <SectionLabel icon="Code">
              Files changed · {pr.files_count} files{smartDiff ? " · Smart Diff (grouped by role)" : ""}
            </SectionLabel>
            {smartDiff && smartDiff.groups.length > 0 ? (
              <SmartDiffViewer smartDiff={smartDiff} files={pr.files} />
            ) : (
              <DiffViewer files={pr.files} />
            )}
          </section>
        )}

        {tab === "conformance" && (
          <section>
            <SectionLabel icon="ListChecks">PRD ↔ PR Conformance</SectionLabel>
            {prId && <ConformanceReport prId={prId} prNumber={pr.number} />}
          </section>
        )}
      </div>

      {/* Drawers (deep-linkable via query params) */}
      {prId && composeOpen && (
        <ComposeReviewDrawer
          prId={prId}
          onClose={() => setParam("compose", null)}
          onPosted={() => refetch()}
        />
      )}
      {prId && traceRunId && (
        <RunTraceDrawer runId={traceRunId} prNumber={pr.number} onClose={() => setParam("trace", null)} />
      )}
      {prId && (
        <WhyTimelineDrawer prId={prId} location={whyLocation} onClose={() => setParam("why", null)} />
      )}
    </AppShell>
  );
}
