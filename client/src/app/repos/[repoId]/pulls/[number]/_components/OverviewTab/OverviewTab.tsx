"use client";

import React from "react";
import { SectionLabel, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import { VerdictBanner } from "../VerdictBanner";
import { usePrBrief, useIntent, useGenerateBrief, useClearBrief } from "@/lib/hooks/reviews";
import { useBlast } from "@/lib/hooks/blast";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "./BlastRadiusCard";
import { ReviewFocusCard } from "./ReviewFocusCard";
import { BriefEmptyState } from "./BriefEmptyState";
import { s } from "./styles";

// ---- OverviewTab ------------------------------------------------------------

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  runs?: ReviewRecord[];
  costUsd?: number | null;
  changedPaths: Set<string>;
}

export function OverviewTab({ prBody, prId, runs = [], costUsd, changedPaths }: OverviewTabProps) {
  const t = useTranslations("blast");
  const { data: brief } = usePrBrief(prId);
  const { data: liveIntent } = useIntent(prId);
  const { data: liveBlastResponse } = useBlast(prId);
  const generateBrief = useGenerateBrief(prId);
  const clearBrief = useClearBrief(prId);

  // ENTIRE Overview surface is gated on the LLM-derived brief: until a brief has
  // been generated, render ONLY the PR Brief empty state — no VerdictBanner,
  // no Intent/Blast cards, no Review Focus, no Description (matches the
  // "No brief yet" reference screenshot; see plan for the generate-to-reveal
  // gating behavior). The `!brief?.llm` guard (rather than a separate boolean)
  // lets TypeScript narrow `brief.llm` to non-null for the rest of the render.
  if (!brief?.llm) {
    return (
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        <BriefEmptyState
          onGenerate={() => generateBrief.mutate()}
          generating={generateBrief.isPending}
          error={generateBrief.isError ? generateBrief.error.message : null}
        />
      </section>
    );
  }

  // Prefer live intent from pr_intent table; fall back to seed brief.intent
  const displayIntent = liveIntent ?? brief.intent;

  const latest = runs[0] ?? null;
  const blockers = latest
    ? latest.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length
    : 0;

  // ---- Blast display preference ----
  // 1. Live response exists and available=true → use live data
  // 2. Live response available=false + no seed brief → empty state
  // 3. Seed brief exists → render from brief.blast/history (no link/index/truncated)
  // 4. Nothing → placeholder
  let blastNode: React.ReactNode;

  if (liveBlastResponse && liveBlastResponse.available && liveBlastResponse.blast) {
    // Live data — fully featured card with link, index badge, truncated counts
    blastNode = (
      <BlastRadiusCard
        blast={liveBlastResponse.blast}
        history={liveBlastResponse.history}
        link={liveBlastResponse.link}
        index={liveBlastResponse.index}
        truncated={liveBlastResponse.truncated}
        cronFiles={liveBlastResponse.cron_files}
      />
    );
  } else if (liveBlastResponse && !liveBlastResponse.available && !brief) {
    // Live response says not available, no seed brief → empty state card
    blastNode = (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <Icon.Zap size={12} />
          {t("header")}
          {liveBlastResponse.index && (liveBlastResponse.index.degraded || liveBlastResponse.index.status === "partial") && (
            <span
              style={s.degradedBadge}
              title={liveBlastResponse.index.reason ?? t("degraded.noIndex")}
              role="status"
              aria-label={`${t("degraded.badge")}: ${liveBlastResponse.index.reason ?? t("degraded.noIndex")}`}
            >
              <Icon.AlertTriangle size={9} />
              {t("degraded.badge")}
            </span>
          )}
        </div>
        <div
          style={{
            ...s.cardBody,
            alignItems: "center",
            justifyContent: "center",
            minHeight: 100,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          {t("empty")}
        </div>
      </div>
    );
  } else if (brief) {
    // Seed brief fallback — no link/index/truncated (links disabled, no badge)
    blastNode = (
      <BlastRadiusCard
        blast={brief.blast}
        history={brief.history}
      />
    );
  } else {
    // No data at all — placeholder
    blastNode = (
      <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 120, color: "var(--text-muted)", fontSize: 13 }}>
        <Icon.Clock size={18} style={{ opacity: 0.4 }} />
        <span>{t("empty")}</span>
      </div>
    );
  }

  return (
    <>
      {/* PR Brief: VerdictBanner enhanced with the LLM-derived brief
          (what/why/risk_level/review_focus). Only reached once hasBrief is true. */}
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        <VerdictBanner
          verdict={latest?.verdict ?? "comment"}
          summary={latest?.summary ?? null}
          score={latest?.score ?? null}
          findingsCount={latest?.findings.length ?? 0}
          blockers={blockers}
          costUsd={costUsd}
          what={brief.llm.what}
          why={brief.llm.why}
          riskLevel={brief.llm.risk_level}
          tokensIn={brief.llm.tokens_in}
          tokensOut={brief.llm.tokens_out}
          onRegenerate={() => generateBrief.mutate()}
          regenerating={generateBrief.isPending}
          generationError={generateBrief.isError ? generateBrief.error.message : null}
          onClear={() => clearBrief.mutate()}
          clearing={clearBrief.isPending}
        />
      </section>

      {/* Intent + Blast Radius cards */}
      <div style={s.cardGrid}>
        {/* Intent: live data preferred (pr_intent table), falls back to seed brief.intent */}
        {displayIntent ? (
          <IntentCard intent={displayIntent} risks={brief?.risks ?? null} changedPaths={changedPaths} />
        ) : (
          <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 120, color: "var(--text-muted)", fontSize: 13 }}>
            <Icon.Clock size={18} style={{ opacity: 0.4 }} />
            <span><strong>Intent</strong> analysis not generated for this PR.</span>
          </div>
        )}

        {/* Blast Radius: live data preferred, seed brief fallback */}
        {blastNode}
      </div>

      {/* Review Focus — "read these first" full-width card */}
      <ReviewFocusCard items={brief.llm.review_focus} changedPaths={changedPaths} />

      {/* Original PR description */}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
