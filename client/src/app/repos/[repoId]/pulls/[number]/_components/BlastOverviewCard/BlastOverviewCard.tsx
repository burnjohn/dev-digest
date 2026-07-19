/* BlastOverviewCard — compact Blast Radius preview for the Overview tab.
   Shows the headline counts + the top impacted symbols (with breaking / finding
   markers) and a "View full blast radius →" link into the dedicated Blast tab.
   Deterministic, no model call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { useBlast } from "@/lib/hooks/blast";
import { blastCounts, isEmptyBlast } from "../BlastRadius/helpers";
import { STAT_ICONS } from "../BlastRadius/constants";

const TOP_N = 3;

export function BlastOverviewCard({ prId, onOpen }: { prId: string | null; onOpen: () => void }) {
  const t = useTranslations("blast");
  const { data: blast } = useBlast(prId);
  if (!blast || isEmptyBlast(blast)) return null;

  const counts = blastCounts(blast);
  const top = blast.downstream.slice(0, TOP_N);

  return (
    <section style={st.card}>
      <div style={st.head}>
        <span style={st.title}>
          <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
          Blast radius
        </span>
        <button style={st.viewBtn} onClick={onOpen} title={t("overview.viewFull")}>
          {t("overview.viewFull")}
          <Icon.ArrowRight size={12} />
        </button>
      </div>

      <div style={st.stats}>
        {STAT_ICONS.map((s) => {
          const I = Icon[s.icon];
          const n = counts[s.key as keyof typeof counts];
          return (
            <span key={s.key} style={st.stat} title={t(`statHelp.${s.key}`)}>
              <I size={12} style={{ color: "var(--text-muted)" }} />
              <b className="tnum" style={st.statVal}>
                {n}
              </b>
              {t(`stat.${s.key}`)}
            </span>
          );
        })}
      </div>

      <div style={st.list}>
        {top.map((d, i) => (
          <button key={`${d.symbol}-${i}`} style={st.row} onClick={onOpen}>
            <Icon.Code size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span className="mono" style={st.sym}>
              {d.symbol}()
            </span>
            {d.breaking && (
              <span style={st.crit} title={t("riskHelp.breaking")}>
                <Icon.AlertOctagon size={11} />
                {t("risk.breaking")}
              </span>
            )}
            {d.finding_severity && <FindingDot severity={d.finding_severity} count={d.finding_count} />}
            <span style={st.count}>{t("callerCount", { count: d.callers.length })}</span>
          </button>
        ))}
        {blast.downstream.length > TOP_N && (
          <button style={st.more} onClick={onOpen}>
            +{blast.downstream.length - TOP_N} more →
          </button>
        )}
      </div>
    </section>
  );
}

function FindingDot({ severity, count }: { severity: Severity; count: number }) {
  const t = useTranslations("blast");
  const sev = SEV[severity];
  const I = Icon[sev.icon as keyof typeof Icon];
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 3, color: sev.c, fontSize: 11, fontWeight: 600 }}
      title={t("findingHelp", { count, severity: sev.label })}
    >
      {I && <I size={11} />}
      {count}
    </span>
  );
}

const st = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "var(--bg-surface)",
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--text-muted)",
  },
  viewBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  stats: { display: "flex", gap: 16, flexWrap: "wrap" },
  stat: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--text-secondary)" },
  statVal: { color: "var(--text-primary)", fontWeight: 650 },
  list: { display: "flex", flexDirection: "column", gap: 2 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 6px",
    border: "none",
    background: "transparent",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
  sym: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" },
  crit: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--crit)",
  },
  count: { fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" },
  more: {
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
    padding: "3px 6px",
  },
} satisfies Record<string, React.CSSProperties>;

export default BlastOverviewCard;
