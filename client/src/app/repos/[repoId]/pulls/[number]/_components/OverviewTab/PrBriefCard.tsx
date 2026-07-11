/* PrBriefCard — the Why+Risk Brief surface on the PR Overview tab.
   Renders: what the PR does (what), motivation (why), an overall risk level
   (high/medium/low — color + text label for a11y), a list of risks with grounded
   file references, and review-focus items as deep links to file:line/symbol.

   Key design decisions:
   - risk_level → color + LABEL (not color alone — a11y, SPEC-02 Non-functional)
   - Focus links anchored to `brief.ref ?? headSha` — exact pattern from
     BlastRadiusPanel.tsx:120-122 (`const linkSha = blast?.ref ?? headSha`)
   - outdated (AC-14b/16b): shows "outdated — regenerate" badge, not stale content silently
   - materialized:false (AC-3b/16b): shows "not enough signal yet" empty state
*/
"use client";

import React from "react";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { BriefRisk, ReviewFocus } from "@devdigest/shared";
import { MonoLink } from "@/vendor/ui/primitives/MonoLink";
import { githubBlobUrl } from "@/lib/github-urls";
import { useBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { s } from "./styles";

// ---- risk_level → color + text label mapping (AC-16, a11y) ----
// Color must NOT be the only signal — label carries the risk text for color-blind users.
const RISK_LEVEL_MAP = {
  high: {
    label: "High risk",
    color: "var(--danger, #f85149)",
    bg: "rgba(248, 81, 73, 0.12)",
  },
  medium: {
    label: "Medium risk",
    color: "var(--warning, #d29922)",
    bg: "rgba(210, 153, 34, 0.12)",
  },
  low: {
    label: "Low risk",
    color: "var(--success, #3fb950)",
    bg: "rgba(63, 185, 80, 0.12)",
  },
} as const;

// severity → color map (reuses the same palette as risk_level)
const SEVERITY_COLOR: Record<"high" | "medium" | "low", string> = {
  high: "var(--danger, #f85149)",
  medium: "var(--warning, #d29922)",
  low: "var(--success, #3fb950)",
};

const SEVERITY_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Risk_level badge with color background + text label (a11y: both channels). */
function RiskLevelBadge({ level }: { level: "high" | "medium" | "low" }) {
  const { label, color, bg } = RISK_LEVEL_MAP[level];
  return (
    <span
      style={{ ...s.briefRiskBadge, color, background: bg }}
      aria-label={label}
    >
      {label}
    </span>
  );
}

/** One risk card with severity color+label, explanation, grounded file refs. */
function RiskCard({ risk }: { risk: BriefRisk }) {
  const color = SEVERITY_COLOR[risk.severity];
  const label = SEVERITY_LABEL[risk.severity];
  return (
    <div style={s.briefRiskCard}>
      <div style={s.briefRiskTitle}>
        {/* Severity dot (color) */}
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        {/* Severity text label — a11y: color is not the only signal */}
        <span style={{ color, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
          {label}
        </span>
        <span>{risk.title}</span>
      </div>
      <p style={s.briefRiskExplanation}>{risk.explanation}</p>
      {risk.file_refs.length > 0 && (
        <div style={s.briefRiskFiles}>
          {risk.file_refs.map((f) => (
            <span key={f} style={s.briefRiskFile}>
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One review-focus item: a deep link to file at line/symbol, keyboard-navigable. */
function FocusItem({
  focus,
  repoFullName,
  refSha,
  headSha,
}: {
  focus: ReviewFocus;
  repoFullName: string | null | undefined;
  refSha: string | null | undefined;
  headSha: string | null | undefined;
}) {
  // Per-item anchor: a caller-file comes from the indexed snapshot → anchor to the blast
  // `ref` sha; a changed-file exists at the PR head → anchor to headSha. Using one sha for
  // every link 404s the other kind of file (AC-10, per-item fix).
  const linkSha = focus.is_caller_ref && refSha ? refSha : headSha;
  const canLink = !!repoFullName && !!linkSha;
  // Build the deep link. If `line` is present, anchor to that line (D8, AC-16).
  const href = canLink
    ? githubBlobUrl(repoFullName!, linkSha!, focus.file, focus.line ?? undefined)
    : undefined;

  // Display: file:line or file#symbol
  const location = focus.line != null
    ? `${focus.file}:${focus.line}`
    : focus.symbol != null
      ? `${focus.file}#${focus.symbol}`
      : focus.file;

  return (
    <div style={s.briefFocusRow}>
      <Icon.FileText size={13} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
      <div>
        <MonoLink href={href}>{location}</MonoLink>
        {focus.reason && (
          <div style={s.briefFocusMeta}>{focus.reason}</div>
        )}
      </div>
    </div>
  );
}

export function PrBriefCard({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
  headSha: string | null | undefined;
}) {
  const { data: brief, isLoading } = useBrief(prId);
  const regenerate = useRegenerateBrief(prId);

  if (isLoading) return null;

  // Anchor sha is chosen PER focus item inside FocusItem: caller-files → brief.ref
  // (indexed snapshot), changed-files → headSha (PR head). See FocusItem.

  // AC-3b / AC-16b: empty brief — "not enough signal yet" empty state.
  // Must not present as a blank low-risk card.
  if (brief && !brief.materialized) {
    return (
      <section>
        <div style={s.intentHeader}>
          <SectionLabel icon="Lightbulb">Why + Risk Brief</SectionLabel>
          <button
            style={s.briefRegenBtn}
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending || !prId}
            title="Generate a fresh brief"
          >
            {regenerate.isPending ? "Generating…" : "Generate"}
          </button>
        </div>
        <div style={s.briefEmpty} data-testid="brief-empty-state">
          Not enough signal yet — run a review to generate the Why + Risk Brief.
        </div>
      </section>
    );
  }

  // No brief fetched yet (null / undefined after load)
  if (!brief) {
    return (
      <section>
        <div style={s.intentHeader}>
          <SectionLabel icon="Lightbulb">Why + Risk Brief</SectionLabel>
          <button
            style={s.briefRegenBtn}
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending || !prId}
            title="Generate a brief for this PR"
          >
            {regenerate.isPending ? "Generating…" : "Generate"}
          </button>
        </div>
        <div style={s.briefEmpty}>
          No brief yet — click Generate to create one.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div style={s.briefHeader}>
        <SectionLabel icon="Lightbulb">Why + Risk Brief</SectionLabel>
        <button
          style={s.briefRegenBtn}
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending || !prId}
          title="Regenerate the brief (costs one LLM call)"
        >
          {regenerate.isPending ? "Generating…" : "Regenerate"}
        </button>
      </div>

      {/* AC-14b / AC-16b: outdated badge — shown when brief built at an older head sha. */}
      {brief.outdated && (
        <div style={s.briefOutdatedBadge} data-testid="brief-outdated-badge">
          <Icon.AlertTriangle size={13} style={{ flexShrink: 0 }} />
          Brief is outdated (new commits since last generation) — regenerate to refresh.
        </div>
      )}

      <div style={s.briefBox}>
        {/* Overall risk level — color + text label (AC-16, a11y) */}
        <div style={{ marginBottom: 10 }}>
          <RiskLevelBadge level={brief.risk_level} />
        </div>

        {/* What this PR does */}
        <p style={s.briefWhat}>{brief.what}</p>

        {/* Why this PR exists */}
        <p style={s.briefWhy}>{brief.why}</p>

        {/* Risks */}
        {brief.risks.length > 0 && (
          <>
            <div style={s.briefSection}>Risks</div>
            {brief.risks.map((risk, i) => (
              <RiskCard key={`${risk.title}-${i}`} risk={risk} />
            ))}
          </>
        )}

        {/* Review Focus */}
        {brief.review_focus.length > 0 && (
          <>
            <div style={s.briefSection}>Review Focus</div>
            <div>
              {brief.review_focus.map((f, i) => (
                <FocusItem
                  key={`${f.file}-${i}`}
                  focus={f}
                  repoFullName={repoFullName}
                  refSha={brief?.ref}
                  headSha={headSha}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
