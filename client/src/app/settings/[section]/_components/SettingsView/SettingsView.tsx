/* Settings — left sub-nav + sections. API Keys (OpenRouter + GitHub PAT, with
   Test connection) and Feature Models. Section is deep-linked at
   /settings/:section. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, SETTINGS_SECTIONS } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { SettingsApiKeys } from "./_components/SettingsApiKeys";
import { SettingsModels } from "./_components/SettingsModels";
import { DEFAULT_SECTION, SECTION_API_KEYS, SECTION_MODELS } from "./constants";
import { s } from "./styles";

export function SettingsView() {
  const t = useTranslations("settings");
  const params = useParams<{ section: string }>();
  const section = params.section ?? DEFAULT_SECTION;
  const current = SETTINGS_SECTIONS.find((sec) => sec.key === section) ?? SETTINGS_SECTIONS[0];

  return (
    <AppShell crumb={[{ label: t("breadcrumb"), href: "/settings/api-keys" }, { label: current.label }]}>
      <div style={s.layout}>
        <div style={s.nav}>
          <h1 style={s.navTitle}>{t("title")}</h1>
          {SETTINGS_SECTIONS.map((sec) => {
            const on = sec.key === section;
            return (
              <Link key={sec.key} href={`/settings/${sec.key}`}>
                <div style={s.navItem(on)}>{sec.label}</div>
              </Link>
            );
          })}
        </div>
        <div style={s.pane}>
          {section === SECTION_API_KEYS ? (
            <SettingsApiKeys />
          ) : section === SECTION_MODELS ? (
            <SettingsModels />
          ) : (
            <EmptyState
              icon="Settings"
              title={current.label}
              body={t("fallbackBody", { label: current.label })}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
