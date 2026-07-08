/* OnboardingTourView — container for the Onboarding Tour page. Fetches the
   persisted tour, owns loading/error/empty branching, and renders the 5 fixed
   sections via SectionCard + per-kind section components.

   Mirrors ContextDocsView.tsx's container/AppShell pattern for this codebase's
   established repo-scoped page shape. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import {
  useOnboardingTour,
  useGenerateOnboardingTour,
  isRateLimitedError,
} from "@/lib/hooks/onboarding";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import type { OnboardingTourSectionKind } from "@devdigest/shared";
import { SectionCard } from "../SectionCard";
import { ArchitectureSection } from "../ArchitectureSection";
import { CriticalPathsSection } from "../CriticalPathsSection";
import { HowToRunSection } from "../HowToRunSection";
import { ReadingPathSection } from "../ReadingPathSection";
import { FirstTasksSection } from "../FirstTasksSection";
import { SECTION_ORDER, relativeTime } from "./constants";
import { s } from "./styles";

interface Props {
  repoId: string;
}

function SectionBody({ kind, section }: { kind: OnboardingTourSectionKind; section: Parameters<typeof ArchitectureSection>[0]["section"] }) {
  switch (kind) {
    case "architecture":
      return <ArchitectureSection section={section} />;
    case "critical_paths":
      return <CriticalPathsSection section={section} />;
    case "how_to_run":
      return <HowToRunSection section={section} />;
    case "reading_path":
      return <ReadingPathSection section={section} />;
    case "first_tasks":
      return <FirstTasksSection section={section} />;
    default:
      return null;
  }
}

export function OnboardingTourView({ repoId }: Props) {
  const t = useTranslations("onboarding");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour(repoId);
  const resync = useResyncRepoIntel(repoId);

  const [copied, setCopied] = React.useState(false);

  const crumb = [{ label: activeRepo?.full_name ?? "Repo" }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const handleShareLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const rateLimited = isRateLimitedError(generate.error);

  // Empty/lite/no-index state: never generated AND no usable index (status
  // degraded or failed with no clone) — render the CTA instead of 5 empty
  // section skeletons with nothing useful to show.
  const showCloneCta =
    !isLoading && !isError && data && data.generated_at === null &&
    (data.run.status === "degraded" || data.run.status === "failed");

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {isError ? (
          <ErrorState onRetry={() => refetch()} title={t("loadError.title")} />
        ) : isLoading || !data ? (
          <div style={s.skeletonWrap}>
            {SECTION_ORDER.map(({ kind }) => (
              <div key={kind} style={s.skeletonCard} />
            ))}
          </div>
        ) : (
          <>
            <div style={s.headerRow}>
              <div>
                <h1 style={s.title}>
                  {t("heading")} <span style={s.accent}>{activeRepo?.full_name ?? repoId}</span>
                </h1>
                <p style={s.subtitle}>
                  {data.generated_at === null
                    ? t("subtitle.neverGenerated")
                    : t("subtitle.withoutCount", { time: relativeTime(data.generated_at) })}
                </p>
              </div>
              <div style={s.actions}>
                {generate.isPending && (
                  <span style={s.inProgress}>
                    <Icon.RefreshCw size={12} style={{ animation: "ddspin 1s linear infinite" }} />
                    {t("generate.generating")}
                  </span>
                )}
                <Button
                  kind="secondary"
                  size="sm"
                  icon="RefreshCw"
                  loading={generate.isPending}
                  disabled={generate.isPending}
                  onClick={() => generate.mutate()}
                >
                  {generate.isPending ? t("regenerating") : t("regenerate")}
                </Button>
                <Button
                  kind="secondary"
                  size="sm"
                  icon={copied ? "Check" : "Link"}
                  onClick={handleShareLink}
                >
                  {copied ? t("shareLinkCopied") : t("shareLink")}
                </Button>
              </div>
            </div>

            {generate.isError && (
              <div style={s.errorBanner} role="alert">
                <Icon.AlertTriangle size={14} style={{ color: "var(--crit)", flexShrink: 0 }} />
                <span>{rateLimited ? t("rateLimited") : t("generateError.title")}</span>
                <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => generate.mutate()}>
                  {t("generateError.retry")}
                </Button>
              </div>
            )}

            {showCloneCta && (
              <EmptyState
                icon="Folder"
                title={t("empty.title")}
                body={t("empty.body")}
                cta={t("cloneCta")}
                onCta={() => resync.mutate()}
                ctaLoading={resync.isPending}
              />
            )}

            <div style={s.layout}>
              <nav style={s.toc} aria-label={t("toc")}>
                <div style={s.tocLabel}>{t("toc")}</div>
                {SECTION_ORDER.map(({ kind, i18nKey }) => (
                  <a key={kind} href={`#section-${kind}`} style={s.tocLink}>
                    {t(`sections_.${i18nKey}`)}
                  </a>
                ))}
              </nav>

              <div style={s.sections}>
                {SECTION_ORDER.map(({ kind, i18nKey, icon }) => {
                  const section = data.sections.find((sec) => sec.kind === kind);
                  if (!section) return null;
                  return (
                    <SectionCard
                      key={kind}
                      id={`section-${kind}`}
                      title={t(`sections_.${i18nKey}`)}
                      icon={icon}
                      run={data.run}
                    >
                      <SectionBody kind={kind} section={section} />
                    </SectionCard>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
