"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { Intent, Risks, Risk } from "@devdigest/shared";
import { useDiffNavigate } from "@/lib/diff-nav";
import { s } from "./styles";

interface IntentCardProps {
  intent: Intent;
  /** Optional — seed briefs carry risks; live intent does not. Section hidden when absent/empty. */
  risks?: Risks | null;
  /** Files touched by this PR's diff — determines internal vs external nav for path:line links. */
  changedPaths?: Set<string>;
}

/** Splits explanation text on backtick-delimited spans, rendering odd segments
 *  as inline `<code>` chips (design sample) and even segments as plain text.
 *  Plain text with no backticks renders as a single text node. */
function renderWithCode(text: string): React.ReactNode[] {
  const parts = text.split("`");
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} style={s.inlineCode}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** Icon per risk kind — matches the design chips (shield / package / zap). */
function riskIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("sec") || k.includes("auth")) return Icon.Shield;
  if (k.includes("dep")) return Icon.Boxes;
  if (k.includes("perf") || k.includes("latency")) return Icon.Zap;
  return Icon.AlertTriangle;
}

/** Icon color per risk kind — reuses existing design tokens only (no new palette). */
function riskIconColor(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("sec") || k.includes("auth")) return "var(--crit)";
  if (k.includes("dep")) return "var(--warn)";
  if (k.includes("perf") || k.includes("latency")) return "#60a5fa";
  return "var(--text-muted)";
}

/** Clickable `path:line` reference — internal diff nav when the file is part
 *  of this PR's diff, else opens the GitHub blob link. Renders nothing when
 *  `file` is absent (pre-existing deterministic risks, backward-compat). */
function RiskPathLink({ risk, changedPaths }: { risk: Risk; changedPaths: Set<string> }) {
  const navigate = useDiffNavigate();
  if (!risk.file) return null;
  const pathLabel = `${risk.file}${risk.line != null ? `:${risk.line}` : ""}`;
  return (
    <button
      type="button"
      style={s.riskCardPathLink}
      title={`Open ${pathLabel}`}
      onClick={(e) => {
        e.stopPropagation();
        navigate(risk.file!, risk.line ?? null, risk.github_link ?? null, changedPaths.has(risk.file!));
      }}
    >
      {pathLabel}
    </button>
  );
}

/**
 * One risk area card — color-coded icon chip + bold title + right-side
 * expand chevron box, with clickable `path:line`. Clicking the card toggles
 * it as the open accordion item (detail renders in a shared panel below the
 * grid — see `IntentCard`).
 */
function RiskRow({
  risk,
  isOpen,
  onToggle,
  changedPaths,
}: {
  risk: Risk;
  isOpen: boolean;
  onToggle: () => void;
  changedPaths: Set<string>;
}) {
  const RiskIcon = riskIcon(risk.kind);
  const iconColor = riskIconColor(risk.kind);
  return (
    <div
      role="button"
      tabIndex={0}
      style={s.riskCard(isOpen, iconColor)}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={isOpen}
    >
      <div style={s.riskCardHeaderRow}>
        <span style={s.riskIconWrap(iconColor)} data-testid="risk-icon-chip">
          <RiskIcon size={14} color={iconColor} />
        </span>
        <span style={s.riskCardTitle}>{risk.title}</span>
        <span style={s.riskChevronBox}>
          <Icon.ChevronDown
            size={12}
            style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .1s" }}
          />
        </span>
      </div>
      <RiskPathLink risk={risk} changedPaths={changedPaths} />
    </div>
  );
}

export function IntentCard({ intent, risks, changedPaths = new Set() }: IntentCardProps) {
  const t = useTranslations("brief");
  const riskList = risks?.risks ?? [];
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const openRisk = openIdx != null ? riskList[openIdx] : undefined;

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.Target size={12} />
        {t("block.intent")}
      </div>
      <div style={s.cardBody}>
        <blockquote style={s.intentQuote}>"{intent.intent}"</blockquote>

        <div style={{ display: "flex", gap: 20 }}>
          {intent.in_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--ok)")}>
                <Icon.Check size={11} />
                {t("inScope")}
              </div>
              {intent.in_scope.map((item, i) => (
                <div key={i} style={s.scopeItem(false)}>
                  <span style={s.scopeBullet}>·</span>
                  {item}
                </div>
              ))}
            </div>
          )}

          {intent.out_of_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--text-muted)")}>
                <Icon.X size={11} />
                {t("outOfScope")}
              </div>
              {intent.out_of_scope.map((item, i) => (
                <div key={i} style={s.scopeItem(true)}>
                  <span style={s.scopeBullet}>·</span>
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>

        {riskList.length > 0 && (
          <>
            <div style={s.intentDivider} />
            <div>
              <div style={s.riskAreasHeader}>
                <Icon.AlertTriangle size={11} />
                {t("riskAreas")}
              </div>
              <div style={s.riskGrid}>
                {riskList.map((risk, i) => (
                  <RiskRow
                    key={i}
                    risk={risk}
                    isOpen={openIdx === i}
                    onToggle={() => setOpenIdx((cur) => (cur === i ? null : i))}
                    changedPaths={changedPaths}
                  />
                ))}
              </div>
              {openRisk && (
                <div style={{ marginTop: 8 }}>
                  <div style={s.riskDetailPanel}>
                    <div>{renderWithCode(openRisk.explanation)}</div>
                    <RiskPathLink risk={openRisk} changedPaths={changedPaths} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
