"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs } from "@devdigest/ui";
import { IMPORT_TABS, DRAWER_WIDTH, type ImportTab } from "./constants";
import { s } from "./styles";
import { FilePanel } from "./_components/FilePanel";
import { UrlPanel } from "./_components/UrlPanel";
import { CommunityPanel } from "./_components/CommunityPanel";

/** Skills import drawer: file (paste body) / url / community search (§7 L02). */
export function ImportDrawer({
  initialTab = "file",
  onClose,
}: {
  initialTab?: ImportTab;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<ImportTab>(initialTab);
  return (
    <Drawer width={DRAWER_WIDTH} title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <Tabs
        tabs={IMPORT_TABS.map((tabDef) => ({ key: tabDef.key, label: t(tabDef.labelKey) }))}
        value={tab}
        onChange={(k) => setTab(k as ImportTab)}
        pad="0"
      />
      <div style={s.tabBody}>
        {tab === "file" && <FilePanel onDone={onClose} />}
        {tab === "url" && <UrlPanel onDone={onClose} />}
        {tab === "community" && <CommunityPanel onDone={onClose} />}
      </div>
    </Drawer>
  );
}
