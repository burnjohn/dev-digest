/* PageShell.tsx — small helpers for route pages: a section container and a
   feature-placeholder that renders inside the app shell with an EmptyState.
   Feature agents (A1–A6) replace `FeaturePlaceholder` with their real screen. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, type IconName } from "@devdigest/ui";
import type { Crumb } from "@devdigest/ui";
import { AppShell } from "../app-shell";
import { s } from "./styles";

export function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div style={s.container}>
      {(title || actions) && (
        <div style={s.headerRow}>
          <div>
            {title && <h1 style={s.h1}>{title}</h1>}
            {subtitle && <p style={s.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div style={s.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

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
