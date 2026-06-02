/* Settings — left sub-nav + sections. API Keys (with Test connection), Automatic
   Reviews, Integrations, Plugins. Section is deep-linked at /settings/:section. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, SETTINGS_SECTIONS } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { AppShell } from "../../../../../components/app-shell";
import { SettingsApiKeys } from "./_components/SettingsApiKeys";
import { SettingsAutoReviews } from "./_components/SettingsAutoReviews";
import { SettingsIntegrations } from "./_components/SettingsIntegrations";
import { SettingsPlugins } from "../PluginsSection";
import {
  DEFAULT_SECTION,
  SECTION_API_KEYS,
  SECTION_AUTO_REVIEWS,
  SECTION_INTEGRATIONS,
  SECTION_PLUGINS,
} from "./constants";
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
          ) : section === SECTION_AUTO_REVIEWS ? (
            <SettingsAutoReviews />
          ) : section === SECTION_INTEGRATIONS ? (
            <SettingsIntegrations />
          ) : section === SECTION_PLUGINS ? (
            <SettingsPlugins />
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
