"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "../../../../../../components/app-shell";
import { usePullDetail } from "../../../../../../lib/hooks";
import { ConformanceReport } from "./_components/ConformanceReport";
import { s } from "./styles";

export default function ConformancePage() {
  const t = useTranslations("conformance");
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const spec = useSearchParams().get("spec") ?? undefined;
  const { data: pr } = usePullDetail(number);
  const prId = pr?.id ?? null;

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbPullRequests"), href: `/repos/${repoId}/pulls` },
        { label: `#${number}`, mono: true, href: `/repos/${repoId}/pulls/${number}` },
        { label: t("page.crumbConformance") },
      ]}
    >
      <div style={s.wrap}>
        {prId ? (
          <ConformanceReport prId={prId} prNumber={Number(number)} spec={spec} />
        ) : (
          <div style={s.loading}>{t("page.loadingPr")}</div>
        )}
      </div>
    </AppShell>
  );
}
