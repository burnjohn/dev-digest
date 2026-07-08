"use client";

import { Icon, Button } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { s } from "./styles";

interface BriefEmptyStateProps {
  onGenerate: () => void;
  generating?: boolean;
  error?: string | null;
}

/**
 * "No brief yet → Generate brief" state of the existing PR BRIEF slot
 * (spec §5 State 1). NOT a new card (AC-19) — rendered inline in place of
 * VerdictBanner when no `llm` brief has ever been generated for this PR.
 */
export function BriefEmptyState({ onGenerate, generating, error }: BriefEmptyStateProps) {
  const t = useTranslations("brief");
  return (
    <div style={s.briefEmptyState}>
      <div style={s.briefEmptyIconBox}>
        <Icon.FileText size={18} />
      </div>
      <div style={s.briefEmptyTitle}>{t("emptyState.title")}</div>
      <div style={s.briefEmptySubtitle}>{t("emptyState.subtitle")}</div>
      <div style={{ marginTop: 8 }}>
        <Button kind="primary" icon="Sparkles" loading={generating} disabled={generating} onClick={onGenerate}>
          {generating ? t("emptyState.generating") : t("emptyState.cta")}
        </Button>
      </div>
      {error && (
        <div style={s.briefEmptyError} role="alert">
          <Icon.AlertTriangle size={13} />
          <span>{t("emptyState.error", { error })}</span>
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onGenerate}>
            {t("emptyState.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
