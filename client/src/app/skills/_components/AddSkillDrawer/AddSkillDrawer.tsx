/* AddSkillDrawer — write a skill, or import one from a .md / .zip.
   Import is preview-then-confirm: the file is extracted server-side and shown,
   and nothing is stored until "Save skill". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Drawer,
  FormField,
  Icon,
  Markdown,
  SelectInput,
  Tabs,
  TextInput,
  Textarea,
} from "@devdigest/ui";
import type { Skill, SkillImportPreview, SkillType } from "@devdigest/shared";
import { ApiError } from "../../../../lib/api";
import { useCreateSkill, useImportSkillPreview } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { SKILL_TYPES } from "../SkillsListView/constants";
import { FileReadError, fileToBase64 } from "../SkillsListView/helpers";
import { s } from "./styles";

export type AddSkillTab = "create" | "file" | "url" | "community";

const ACCEPT = ".md,.markdown,.zip";

export function AddSkillDrawer({
  initialTab = "create",
  onClose,
  onCreated,
}: {
  initialTab?: AddSkillTab;
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const extract = useImportSkillPreview();

  const [tab, setTab] = React.useState<AddSkillTab>(initialTab);

  // --- write-it-yourself form
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  // --- import
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [filename, setFilename] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setFilename(file.name);
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await extract.mutateAsync({
        filename: file.name,
        content_base64: contentBase64,
      });
      setPreview(result);
    } catch (err) {
      // ApiError carries a server message; anything else that is not our own
      // marker is unexpected, and its text is not something to show a user.
      if (err instanceof FileReadError) setError(t("file.readError"));
      else if (err instanceof ApiError) setError(err.message);
      else setError(t("file.readError"));
    }
  };

  const saveWritten = () =>
    create.mutate(
      { name, description, type, body, source: "manual" },
      {
        onSuccess: (skill) => {
          toast.success(t("create.success", { name: skill.name }));
          onCreated?.(skill);
          onClose();
        },
      },
    );

  const saveImported = () => {
    if (!preview) return;
    create.mutate(
      {
        name: preview.name,
        description: preview.description,
        type: preview.type,
        body: preview.body,
        // The extractor decided this, not the UI. Forwarding it verbatim is what
        // keeps the disabled-on-arrival rule from depending on a client
        // remembering to declare where the body came from.
        source: preview.source,
      },
      {
        onSuccess: (skill) => {
          toast.success(t("file.success", { name: skill.name }));
          onCreated?.(skill);
          onClose();
        },
      },
    );
  };

  const tabs = [
    { key: "create", label: t("drawer.tabs.create"), icon: "Edit" as const },
    { key: "file", label: t("drawer.tabs.file"), icon: "Upload" as const },
    { key: "url", label: t("drawer.tabs.url"), icon: "Globe" as const },
    { key: "community", label: t("drawer.tabs.community"), icon: "Users" as const },
  ];

  const canCreate = name.trim().length > 0 && body.trim().length > 0;

  return (
    <Drawer
      width={760}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {tab === "create" && (
            <Button
              kind="primary"
              size="sm"
              icon="Check"
              onClick={saveWritten}
              disabled={!canCreate || create.isPending}
            >
              {create.isPending ? t("create.creating") : t("create.create")}
            </Button>
          )}
          {tab === "file" && (
            <Button
              kind="primary"
              size="sm"
              icon="Check"
              onClick={saveImported}
              disabled={!preview || create.isPending}
            >
              {create.isPending ? t("file.importing") : t("file.import")}
            </Button>
          )}
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("drawer.cancel")}
          </Button>
        </div>
      }
    >
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as AddSkillTab)} pad="0" />
      </div>

      {tab === "create" && (
        <>
          <FormField label={t("create.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} />
          </FormField>
          <FormField label={t("create.descriptionLabel")} hint={t("create.descriptionHint")}>
            <Textarea
              value={description}
              onChange={setDescription}
              rows={3}
              placeholder={t("create.descriptionPlaceholder")}
            />
          </FormField>
          <FormField label={t("create.typeLabel")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              mono={false}
              options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
            />
          </FormField>
          <FormField label={t("create.bodyLabel")} hint={t("create.bodyHint")} required>
            <Textarea
              value={body}
              onChange={setBody}
              rows={14}
              mono
              placeholder={t("create.bodyPlaceholder")}
            />
          </FormField>
        </>
      )}

      {tab === "file" && (
        <>
          <FormField label={t("file.pickLabel")} hint={t("file.pickHint")}>
            <div style={s.pickRow}>
              <Button
                kind="secondary"
                size="sm"
                icon="Upload"
                onClick={() => fileInput.current?.click()}
                disabled={extract.isPending}
              >
                {extract.isPending ? t("file.extracting") : t("file.pick")}
              </Button>
              {filename && <span style={s.pickedName}>{filename}</span>}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              style={s.hiddenInput}
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                // Reset so re-picking the SAME file fires change again.
                e.target.value = "";
              }}
            />
          </FormField>

          {error && <div style={s.error}>{`${t("drawer.importFailed")} — ${error}`}</div>}

          {preview && (
            <div style={s.previewWrap}>
              <div style={s.previewHead}>
                <span style={s.previewTitle}>{t("file.previewTitle")}</span>
                <span style={s.previewHint}>{t("file.previewHint")}</span>
              </div>

              <div style={s.metaRow}>
                <Badge color="var(--text-primary)">{preview.name}</Badge>
                <Badge color="var(--text-muted)">{t(`listItem.type.${preview.type}`)}</Badge>
                <Badge color="var(--text-muted)" mono>
                  {t("file.extractedFrom", { path: preview.source_path })}
                </Badge>
              </div>

              <div style={s.warning}>
                <Icon.AlertTriangle size={14} style={s.warningIcon} />
                <span>{t("file.trustWarning")}</span>
              </div>

              {preview.ignored.length > 0 && (
                <>
                  <div style={s.ignoredHint}>
                    {`${t("file.ignoredLabel", { count: preview.ignored.length })} — ${t("file.ignoredHint")}`}
                  </div>
                  <ul style={s.ignoredList} className="mono">
                    {preview.ignored.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </>
              )}

              <div style={s.bodyBox}>
                <Markdown>{preview.body}</Markdown>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "url" && <div style={s.unavailable}>{t("url.hint")}</div>}
      {tab === "community" && <div style={s.unavailable}>{t("community.hint")}</div>}
    </Drawer>
  );
}
