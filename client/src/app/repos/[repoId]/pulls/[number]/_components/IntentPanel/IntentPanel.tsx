"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Intent } from "@/lib/types";
import { s } from "./styles";

const CONFIDENCE_COLOR: Record<Intent["confidence"], { color: string; bg: string }> = {
  high: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

interface IntentPanelProps {
  intent: Intent | null | undefined;
  isLoading: boolean;
  /** The PR's current head SHA — compared against `intent.head_sha` for staleness. */
  headSha: string;
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * PR Intent Layer panel — shown on the Overview tab, before the review
 * findings. Summary + in/out-of-scope lists + a confidence badge + a
 * staleness indicator when new commits landed since classification, plus a
 * "Re-detect intent" button (forces `POST /pulls/:id/intent/refresh`). Risk
 * areas (demoted CRITICAL findings outside declared scope) render as their
 * own chip block, separate from the main findings list.
 */
export function IntentPanel({ intent, isLoading, headSha, onRefresh, refreshing }: IntentPanelProps) {
  const t = useTranslations("intent");

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <div style={s.box}>
          <Skeleton height={16} width={280} />
          <Skeleton height={40} />
        </div>
      </section>
    );
  }

  if (!intent) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <div style={s.box}>
          <div style={s.emptyBody}>
            <strong>{t("notClassifiedTitle")}</strong>
            <div>{t("notClassifiedBody")}</div>
          </div>
          <div>
            <Button size="sm" icon="Target" loading={refreshing} onClick={onRefresh}>
              {t("detect")}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const stale = intent.head_sha != null && intent.head_sha !== headSha;
  const confColor = CONFIDENCE_COLOR[intent.confidence];

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button size="sm" kind="ghost" icon="RefreshCw" loading={refreshing} onClick={onRefresh}>
            {t("redetect")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Badge color={confColor.color} bg={confColor.bg} icon={intent.confidence === "low" ? "AlertTriangle" : "CheckCircle"}>
            {t(`confidence.${intent.confidence}`)}
          </Badge>
          {stale && (
            <span style={s.staleNote}>
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("stale")}
              </Badge>
            </span>
          )}
        </div>

        <div style={s.summary}>{intent.intent}</div>

        <div style={s.scopeGrid}>
          <div style={s.scopeCol}>
            <span style={s.scopeLabel}>{t("inScope")}</span>
            <div style={s.scopeList}>
              {intent.in_scope.length === 0 && <span>—</span>}
              {intent.in_scope.map((item, i) => (
                <span key={i}>• {item}</span>
              ))}
            </div>
          </div>
          <div style={s.scopeCol}>
            <span style={s.scopeLabel}>{t("outOfScope")}</span>
            <div style={s.scopeList}>
              {intent.out_of_scope.length === 0 && <span>—</span>}
              {intent.out_of_scope.map((item, i) => (
                <span key={i}>• {item}</span>
              ))}
            </div>
          </div>
        </div>

        {intent.signals_used.length > 0 && (
          <div style={s.signalsNote}>{t("signalsUsed", { signals: intent.signals_used.join(", ") })}</div>
        )}
      </div>

      {intent.risk_areas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel icon="AlertTriangle">{t("riskAreas")}</SectionLabel>
          <div style={s.chipsRow}>
            {intent.risk_areas.map((area, i) => (
              <Badge key={i} color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
