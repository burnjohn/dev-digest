"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon, MonoLink, type IconName } from "@devdigest/ui";
import { SectionTitle } from "../SectionTitle";
import { s } from "./styles";

function IntegrationCard({
  icon,
  title,
  status,
  statusColor,
  desc,
  children,
}: {
  icon: IconName;
  title: string;
  status?: string;
  statusColor?: string;
  desc: string;
  children?: React.ReactNode;
}) {
  const I = Icon[icon];
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <div style={s.cardIcon}>
          <I size={18} />
        </div>
        <div style={s.cardTitleWrap}>
          <div style={s.cardTitle}>{title}</div>
          <div style={s.cardDesc}>{desc}</div>
        </div>
        {status && (
          <Badge color={statusColor} bg="transparent" dot>
            {status}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

export function SettingsIntegrations() {
  const t = useTranslations("settings");
  return (
    <div style={s.wrap}>
      <SectionTitle title={t("integrations.title")} body={t("integrations.body")} />
      <IntegrationCard
        icon="Workflow"
        title={t("integrations.githubActionTitle")}
        status={t("integrations.githubActionStatus")}
        statusColor="var(--text-muted)"
        desc={t("integrations.githubActionDesc")}
      >
        <Button kind="secondary" size="sm" icon="Plus">
          {t("integrations.installInRepo")}
        </Button>
        <div style={s.cardNote}>{t("integrations.ciNote")}</div>
      </IntegrationCard>
      <IntegrationCard
        icon="Upload"
        title={t("integrations.pluginExportTitle")}
        desc={t("integrations.pluginExportDesc")}
      >
        <Button kind="secondary" size="sm" icon="Boxes">
          {t("integrations.exportWorkspace")}
        </Button>
        <div style={s.cardNote}>
          {t("integrations.pluginNote")} <MonoLink>{t("integrations.learnMore")}</MonoLink>
        </div>
      </IntegrationCard>
    </div>
  );
}
