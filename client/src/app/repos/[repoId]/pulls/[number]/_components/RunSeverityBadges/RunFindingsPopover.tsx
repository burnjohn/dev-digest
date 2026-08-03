"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { POPOVER_CAP } from "./constants";

/**
 * Hover panel listing a run's findings — internal to RunSeverityBadges.
 * Informational only: nothing inside is interactive (clicking the badge group
 * opens the run trace instead), so no focus trap / Escape handling.
 *
 * Rendered as a DOM child of the hover anchor: the pointer can travel from the
 * badges into the panel without firing the anchor's mouseleave. The visual gap
 * below the badges comes from paddingTop on the wrapper (not a top offset), so
 * there is no dead strip that would close the popover mid-way.
 */

const panelStyle: React.CSSProperties = {
  width: "min(380px, 70vw)",
  maxHeight: 320,
  overflowY: "auto",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  padding: "10px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  cursor: "default",
  textAlign: "left",
};

const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--text-secondary)",
};

export function RunFindingsPopover({ findings }: { findings: FindingRecord[] }) {
  const t = useTranslations("prReview");
  const shown = findings.slice(0, POPOVER_CAP);
  const more = findings.length - shown.length;

  return (
    <div
      role="tooltip"
      style={{ position: "absolute", top: "100%", left: 0, zIndex: 40, paddingTop: 6 }}
    >
      <div style={panelStyle}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {t("timeline.findingsPopoverTitle", { count: findings.length })}
        </div>

        {shown.map((f) => {
          const s = SEV[f.severity];
          const I = Icon[s.icon];
          return (
            <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <I size={13} style={{ color: s.c, flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    opacity: f.dismissed_at ? 0.55 : 1,
                  }}
                >
                  {f.title}
                </span>
                <span style={{ flexShrink: 0 }}>
                  <CategoryTag category={f.category} />
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 20 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
                  {f.file}:{f.start_line}
                  {f.end_line !== f.start_line ? `-${f.end_line}` : ""}
                </span>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={{ ...clamp2, paddingLeft: 20 }}>{f.rationale}</div>
            </div>
          );
        })}

        {more > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("timeline.moreFindings", { count: more })}
          </div>
        )}
      </div>
    </div>
  );
}
