/* Onboarding Tour — /repos/:repoId/onboarding (A3, L05).
   5 RAG-generated sections as an accordion + sticky TOC; ?section= deep-links
   the open/scrolled section. Generate / regenerate via RAG. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import { useOnboarding, useGenerateOnboarding } from "../../../../../../lib/hooks/onboarding";
import { isNotGenerated } from "./helpers";
import { SectionCard } from "./_components/SectionCard";
import { s } from "./styles";

/** Onboarding Tour page body (route: /repos/:repoId/onboarding). */
export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  const { data, isLoading, isError, error } = useOnboarding(repoId);
  const generate = useGenerateOnboarding(repoId);

  const sectionParam = search.get("section");
  const sections = data?.sections ?? [];
  const [openKind, setOpenKind] = React.useState<string | null>(null);

  // Sync open section from ?section= (deep-link) once data is present.
  React.useEffect(() => {
    if (sections.length === 0) return;
    const target = sectionParam ?? sections[0]?.kind ?? null;
    setOpenKind(target);
    if (sectionParam) {
      const el = document.getElementById(sectionParam);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sectionParam, sections.length]);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("title") },
  ];

  const setSection = (kind: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("section", kind);
    router.replace(`/repos/${repoId}/onboarding?${sp.toString()}`);
  };

  const notGenerated = isNotGenerated(isError, error);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {isLoading ? (
          <div style={s.loadingStack}>
            <Skeleton height={28} width={320} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : notGenerated ? (
          <EmptyState
            icon="Boxes"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
            onCta={() => generate.mutate()}
          />
        ) : isError ? (
          <ErrorState title={t("loadError.title")} body={(error as Error)?.message ?? t("unknownError")} />
        ) : (
          <div style={s.layout}>
            {/* sticky TOC */}
            <nav>
              <div style={s.tocSticky}>
                <div style={s.tocLabel}>{t("sections")}</div>
                {sections.map((sec) => (
                  <a
                    key={sec.kind}
                    href={`#${sec.kind}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setSection(sec.kind);
                    }}
                    style={s.tocLink(openKind === sec.kind)}
                  >
                    {sec.title}
                  </a>
                ))}
              </div>
            </nav>

            {/* sections */}
            <div>
              <div style={s.headerRow}>
                <h1 style={s.h1}>{t("title")}</h1>
                <Badge mono>{t("sectionCount", { count: sections.length })}</Badge>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="RefreshCw"
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                >
                  {generate.isPending ? t("regenerating") : t("regenerate")}
                </Button>
              </div>
              {sections.map((sec) => (
                <SectionCard
                  key={sec.kind}
                  section={sec}
                  open={openKind === sec.kind}
                  onToggle={() => setSection(sec.kind)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default OnboardingTourView;
