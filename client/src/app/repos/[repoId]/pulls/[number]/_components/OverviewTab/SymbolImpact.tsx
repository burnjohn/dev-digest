"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { DownstreamImpact, BlastLink } from "@devdigest/shared";
import { formatCron } from "./cron";
import { s } from "./styles";

function httpMethod(ep: string) {
  const m = ep.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/);
  return m ? { method: m[1]!, path: ep.slice(m[1]!.length + 1) } : { method: null, path: ep };
}

/** Build a GitHub blob URL for a caller reference. */
function ghBlobUrl(link: BlastLink, file: string, line: number): string {
  return `https://github.com/${link.owner}/${link.repo}/blob/${link.head_sha}/${encodeURI(file)}#L${line}`;
}

interface SymbolImpactProps {
  impact: DownstreamImpact;
  /** When present, caller file:line is rendered as a clickable GitHub anchor. */
  link?: BlastLink | null;
  /** Number of callers hidden by the server-side cap for this symbol. */
  truncatedCount?: number;
  /** cron value → declaring file(s), for labelling cron badges by file name. */
  cronFiles?: Record<string, string[]>;
}

/**
 * One changed symbol → its callers → the HTTP endpoints / cron jobs reachable
 * from those callers. Pure repo-intel read: colors encode the TYPE of the
 * affected thing (blue = HTTP endpoint, amber = cron), never review findings.
 */
export function SymbolImpact({ impact, link, truncatedCount, cronFiles }: SymbolImpactProps) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div>
      <button
        type="button"
        style={{ ...s.symbolRow, cursor: "pointer", background: "none", border: "none", width: "100%", textAlign: "left" }}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <Icon.ChevronRight
          size={12}
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .1s",
            flexShrink: 0,
          }}
        />
        <Icon.Code size={12} style={{ color: "#60a5fa", flexShrink: 0 }} />
        <span style={s.symbolName}>{impact.symbol}</span>
        <span style={s.callerCount}>
          {t("callerCount", { count: impact.callers.length })}
        </span>
      </button>
      {expanded && (
        <>
          <div style={s.callerLines}>
            {impact.callers.map((c, i) =>
              link ? (
                <a
                  key={i}
                  href={ghBlobUrl(link, c.file, c.line)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...s.callerLine, textDecoration: "none", color: "var(--text-muted)" }}
                >
                  <Icon.CornerDownRight size={10} style={{ color: "var(--border)", flexShrink: 0 }} />
                  <span>{c.file}:{c.line}</span>
                </a>
              ) : (
                <span key={i} style={s.callerLine}>
                  <Icon.CornerDownRight size={10} style={{ color: "var(--border)" }} />
                  {c.file}:{c.line}
                </span>
              )
            )}
          </div>
          {(truncatedCount ?? 0) > 0 && (
            <div style={s.callerMore}>{t("more", { count: truncatedCount })}</div>
          )}
          {impact.endpoints_affected.length > 0 && (
            <div style={s.endpointBadgeRow}>
              {impact.endpoints_affected.map((ep, i) => {
                const { method, path } = httpMethod(ep);
                return (
                  <span key={i} style={s.httpBadge()}>
                    <Icon.Globe size={9} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                    {method ? `${method} ${path}` : ep}
                  </span>
                );
              })}
            </div>
          )}
          {impact.crons_affected.length > 0 && (
            <div style={s.endpointBadgeRow}>
              {impact.crons_affected.map((cr, i) => (
                <span key={i} style={s.cronBadge} title={cr}>
                  <Icon.Clock size={9} />
                  {formatCron(cr, cronFiles?.[cr])}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
