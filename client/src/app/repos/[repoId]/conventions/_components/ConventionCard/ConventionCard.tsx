"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, MonoLink, ProgressBar, Icon } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { confidenceColor, copySnippet } from "./helpers";
import { s } from "./styles";

/** One extracted convention candidate: rule + evidence (file + snippet) + confidence. */
export function ConventionCard({
  c,
  onAccept,
  accepting,
}: {
  c: ConventionCandidate;
  onAccept: () => void;
  accepting: boolean;
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.card(c.accepted)}>
      <div style={s.row}>
        <div style={s.main}>
          <div style={s.rule}>{c.rule}</div>
          <div style={s.evidence}>
            <div style={s.evidenceHeader}>
              <MonoLink>{c.evidence_path}</MonoLink>
              <Icon.Copy size={12} style={s.copyIcon} onClick={() => copySnippet(c.evidence_snippet)} />
            </div>
            <pre className="mono" style={s.snippet}>
              {c.evidence_snippet}
            </pre>
          </div>
          <div style={s.confidenceRow}>
            <span style={s.confidenceLabel}>{t("card.confidence")}</span>
            <div style={s.confidenceBar}>
              <ProgressBar value={c.confidence * 100} height={5} color={confidenceColor(c.confidence)} />
            </div>
            <span className="mono tnum" style={s.confidenceValue}>
              {Math.round(c.confidence * 100)}%
            </span>
          </div>
        </div>
        <div style={s.actionCol}>
          {c.accepted ? (
            <div style={s.acceptedBadge}>
              <Icon.CheckCircle size={15} /> {t("card.accepted")}
            </div>
          ) : (
            <Button kind="primary" size="sm" icon="Sparkles" full onClick={onAccept} disabled={accepting}>
              {accepting ? t("card.accepting") : t("card.acceptAsSkill")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
