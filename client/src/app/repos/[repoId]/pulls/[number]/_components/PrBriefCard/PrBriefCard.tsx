/* PrBriefCard — PR Brief Card (A3, L05).
   Default-exported so the orchestrator can mount it in the PR-detail Overview
   tab. Four blocks per §6: Intent · Blast · Risks · History. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Chip, Skeleton } from "@devdigest/ui";
import type { PrBrief, Risk } from "@devdigest/shared";
import { usePrBrief } from "../../../../../../../lib/hooks/brief";
import { BlastRadiusView } from "../BlastRadius";
import { BLOCK_ICONS, MAX_RISK_FILE_REFS, SEV_COLOR } from "./constants";
import { s } from "./styles";

function Block({
  icon,
  title,
  children,
  right,
}: {
  icon: keyof typeof Icon;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const I = Icon[icon];
  return (
    <section style={s.block}>
      <div style={s.blockHeader}>
        <I size={14} style={s.blockIcon} />
        <span style={s.blockTitle}>{title}</span>
        {right && <span style={s.blockRight}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

function IntentBlock({ intent }: { intent: PrBrief["intent"] }) {
  return (
    <div>
      <p style={s.intentText}>{intent.intent}</p>
      <div style={s.chipRow}>
        {intent.in_scope.map((scope, i) => (
          <Chip key={`in-${i}`} icon="Check" color="var(--ok)">
            {scope}
          </Chip>
        ))}
        {intent.out_of_scope.map((scope, i) => (
          <Chip key={`out-${i}`} icon="Slash" color="var(--text-muted)">
            {scope}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function RiskRow({ risk }: { risk: Risk }) {
  const c = SEV_COLOR[risk.severity];
  return (
    <div style={s.riskRow}>
      <div style={s.riskHeader}>
        <Badge color={c.color} bg={c.bg} icon="AlertTriangle">
          {risk.severity}
        </Badge>
        <span style={s.riskTitle}>{risk.title}</span>
        <span style={s.riskKind} className="mono">
          {risk.kind}
        </span>
      </div>
      <p style={s.riskExplanation}>{risk.explanation}</p>
      {risk.file_refs.length > 0 && (
        <div style={s.riskFileRefs}>
          {risk.file_refs.slice(0, MAX_RISK_FILE_REFS).map((f, i) => (
            <span key={i} className="mono" style={s.riskFileRef}>
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: PrBrief["history"]["history"][number] }) {
  const t = useTranslations("brief");
  return (
    <div style={s.historyRow}>
      <Icon.GitMerge size={14} style={s.historyIcon} />
      <div style={s.historyBody}>
        <div style={s.historyTitleLine}>
          <span className="mono" style={s.historyPrNum}>
            #{item.pr_number}
          </span>{" "}
          <span style={s.historyTitle}>{item.title}</span>
        </div>
        <div style={s.historyMeta}>
          {item.author} · {item.notes}
        </div>
      </div>
      <Badge mono>{t("overlap", { count: item.files_overlap.length })}</Badge>
    </div>
  );
}

export interface PrBriefCardProps {
  prId: string;
  /** Optional git-why hook wired by the PR-detail page (key `w`). */
  onWhy?: (file: string, line: number) => void;
}

/** PR Brief Card — Intent + Blast + Risks + History. */
export function PrBriefCard({ prId, onWhy }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading, isError, error } = usePrBrief(prId);

  if (isLoading) {
    return (
      <div style={s.loadingStack}>
        <Skeleton height={20} width={260} />
        <Skeleton height={80} />
        <Skeleton height={60} />
      </div>
    );
  }
  if (isError || !brief) {
    return (
      <div style={s.errorState}>
        {t("unavailable")} {(error as Error | undefined)?.message ?? t("unavailableHint")}
      </div>
    );
  }

  const riskCount = brief.risks.risks.length;
  return (
    <div style={s.root}>
      <Block icon={BLOCK_ICONS.intent} title={t("block.intent")}>
        <IntentBlock intent={brief.intent} />
      </Block>

      <Block icon={BLOCK_ICONS.blast} title={t("block.blast")}>
        <BlastRadiusView blast={brief.blast} onWhy={onWhy} />
      </Block>

      <Block icon={BLOCK_ICONS.risks} title={t("block.risks")} right={<Badge mono>{riskCount}</Badge>}>
        {riskCount === 0 ? (
          <div style={s.muted}>{t("noRisks")}</div>
        ) : (
          <div style={s.risksList}>
            {brief.risks.risks.map((r, i) => (
              <RiskRow key={i} risk={r} />
            ))}
          </div>
        )}
      </Block>

      <Block
        icon={BLOCK_ICONS.history}
        title={t("block.history")}
        right={<Badge mono>{brief.history.history.length}</Badge>}
      >
        {brief.history.history.length === 0 ? (
          <div style={s.muted}>{t("noHistory")}</div>
        ) : (
          <div>
            {brief.history.history.map((h, i) => (
              <HistoryRow key={i} item={h} />
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}

export default PrBriefCard;
