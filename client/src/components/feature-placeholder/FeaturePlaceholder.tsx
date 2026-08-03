/* FeaturePlaceholder.tsx — renders inside the app shell with an EmptyState for
   a route not yet built out. Currently unused: every A1–A6 feature route has
   its real screen, but kept for the next route that starts as a placeholder. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, type IconName } from "@devdigest/ui";
import type { Crumb } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/app/_components/PageContainer";

/** Placeholder for routes owned by feature agents. Renders full shell + EmptyState. */
export function FeaturePlaceholder({
  crumb,
  title,
  icon = "Boxes",
  owner,
  body,
}: {
  crumb?: Crumb[];
  title: string;
  icon?: IconName;
  owner: string;
  body?: string;
}) {
  const t = useTranslations("shell");
  return (
    <AppShell crumb={crumb}>
      <PageContainer>
        <EmptyState
          icon={icon}
          title={title}
          body={body ?? t("featurePlaceholder.defaultBody", { owner })}
        />
      </PageContainer>
    </AppShell>
  );
}
