/* Settings → Plugins & Digest (A6). Plugin export (download a .devdigest-plugin
   bundle) / import (paste or upload), installed list, and Weekly Digest run+list.
   Demonstrates the cross-cutting toast system for system-level feedback (§11). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Markdown, EmptyState, SectionLabel } from "@devdigest/ui";
import type { PluginBundle } from "@devdigest/shared";
import { useInstalledPlugins, useExportPlugin, useImportPlugin } from "../../../../../lib/hooks/plugins";
import { useDigests, useRunDigest } from "../../../../../lib/hooks/digest";
import { useToast } from "../../../../../lib/toast";
import { ApiError } from "../../../../../lib/api";
import { EXPORT_NAME, IMPORT_TEXTAREA_ROWS, JSON_MIME } from "./constants";
import { downloadJson } from "./helpers";
import { s } from "./styles";

export function SettingsPlugins() {
  const t = useTranslations("settings");
  const toast = useToast();
  const installed = useInstalledPlugins();
  const exportM = useExportPlugin();
  const importM = useImportPlugin();
  const digests = useDigests();
  const runDigest = useRunDigest();
  const [importText, setImportText] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onExport = async () => {
    try {
      const bundle = await exportM.mutateAsync({ name: EXPORT_NAME });
      downloadJson(bundle);
      toast.success(
        t("plugins.exportSuccess", {
          agents: bundle.manifest.counts.agents,
          skills: bundle.manifest.counts.skills,
        }),
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("plugins.exportFailed"));
    }
  };

  const onImport = async () => {
    try {
      const bundle = JSON.parse(importText) as PluginBundle;
      const res = await importM.mutateAsync(bundle);
      toast.success(
        t("plugins.importSuccess", { agents: res.created.agents, skills: res.created.skills }),
      );
      setImportText("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("plugins.importFailed"));
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setImportText);
  };

  return (
    <div style={s.wrap}>
      <SectionLabel icon="Boxes">{t("plugins.bundleLabel")}</SectionLabel>
      <p style={s.intro}>
        {t.rich("plugins.intro", {
          mono: (chunks) => <span className="mono">{chunks}</span>,
        })}
      </p>
      <div style={s.actionsRow}>
        <Button kind="primary" icon="ArrowDown" onClick={onExport} disabled={exportM.isPending}>
          {exportM.isPending ? t("plugins.exporting") : t("plugins.exportBundle")}
        </Button>
        <input ref={fileRef} type="file" accept={JSON_MIME} onChange={onFile} style={s.hiddenInput} />
        <Button kind="ghost" icon="Upload" onClick={() => fileRef.current?.click()}>
          {t("plugins.chooseFile")}
        </Button>
      </div>
      <textarea
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder={t("plugins.importPlaceholder")}
        rows={IMPORT_TEXTAREA_ROWS}
        style={s.textarea}
      />
      <div style={s.importRow}>
        <Button
          kind="secondary"
          icon="Upload"
          onClick={onImport}
          disabled={!importText.trim() || importM.isPending}
        >
          {importM.isPending ? t("plugins.importing") : t("plugins.importBundle")}
        </Button>
      </div>

      <div style={s.section}>
        <SectionLabel icon="Boxes">{t("plugins.installedLabel")}</SectionLabel>
        {installed.data && installed.data.length > 0 ? (
          <div style={s.installedList}>
            {installed.data.map((p) => (
              <div key={p.id} style={s.installedRow}>
                <span style={s.installedName}>{p.name}</span>
                {p.version && <Badge color="var(--text-muted)">{p.version}</Badge>}
                <Badge color={p.enabled ? "var(--ok)" : "var(--text-muted)"}>
                  {p.enabled ? t("plugins.enabled") : t("plugins.disabled")}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="Boxes" title={t("plugins.noPluginsTitle")} body={t("plugins.noPluginsBody")} />
        )}
      </div>

      <div style={s.section}>
        <SectionLabel
          icon="Bell"
          right={
            <Button
              kind="ghost"
              size="sm"
              icon="Sparkles"
              onClick={() => runDigest.mutate()}
              disabled={runDigest.isPending}
            >
              {runDigest.isPending ? t("plugins.building") : t("plugins.buildDigest")}
            </Button>
          }
        >
          {t("plugins.weeklyDigestLabel")}
        </SectionLabel>
        {digests.data && digests.data.length > 0 ? (
          <div style={s.digestCard}>
            <Markdown>{digests.data[0]!.body_md ?? t("plugins.emptyDigest")}</Markdown>
          </div>
        ) : (
          <EmptyState icon="Bell" title={t("plugins.noDigestsTitle")} body={t("plugins.noDigestsBody")} />
        )}
      </div>
    </div>
  );
}
