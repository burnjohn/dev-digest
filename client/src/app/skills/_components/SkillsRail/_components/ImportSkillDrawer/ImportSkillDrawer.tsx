/* ImportSkillDrawer — pick a .md or .zip, read what the server parsed out of it,
   then confirm. Two steps on purpose: an imported skill's text becomes
   instructions inside your agent's prompt, so nothing is stored until the user
   has seen exactly what would be stored. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, Markdown, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportSkillPreview } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { DRAWER_WIDTH, IMPORT_ACCEPT, TYPE_VALUES } from "../../../../constants";
import { readFileAsBase64 } from "../../../../helpers";
import { s } from "../../../../styles";

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const parse = useImportSkillPreview();
  const create = useCreateSkill();

  const [filename, setFilename] = React.useState("");
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Editable before saving: the parse is a best guess at name/description/type.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFilename(file.name);
    try {
      const contentB64 = await readFileAsBase64(file);
      const parsed = await parse.mutateAsync({ filename: file.name, contentB64 });
      setPreview(parsed);
      setName(parsed.name);
      setDescription(parsed.description);
      setType(parsed.type);
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError ? e.message : t("drawer.importFailed"));
    }
  };

  const confirm = async () => {
    if (!preview) return;
    try {
      await create.mutateAsync({
        name,
        description,
        type,
        body: preview.body,
        // Imported skills carry a non-manual source, which is what badges them
        // as third-party everywhere they are shown.
        source: preview.source,
        // Off until the user has read it and turned it on deliberately.
        enabled: false,
      });
      toast.success(t("file.success", { name }));
      onClose();
    } catch {
      toast.error(t("drawer.importFailed"));
    }
  };

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.drawerFooter}>
          <Button
            kind="primary"
            icon="Upload"
            onClick={confirm}
            disabled={!preview || create.isPending || name.trim().length === 0}
          >
            {create.isPending ? t("file.importing") : t("file.import")}
          </Button>
          <Button kind="ghost" onClick={onClose}>
            {t("preview.cancel")}
          </Button>
        </div>
      }
    >
      <div style={s.drawerBody}>
        <div style={s.notice}>{t("drawer.trustNotice")}</div>

        <FormField label={t("drawer.fileLabel")} hint={t("drawer.fileHint")}>
          <div style={s.fileRow}>
            <input
              type="file"
              accept={IMPORT_ACCEPT}
              aria-label={t("drawer.fileLabel")}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            {parse.isPending && <span style={s.fileName}>{t("url.fetching")}</span>}
          </div>
        </FormField>

        {error && <div style={s.error}>{error}</div>}

        {preview && (
          <>
            <FormField label={t("preview.fields.name")} required>
              <TextInput value={name} onChange={setName} />
            </FormField>
            <FormField label={t("preview.fields.description")} hint={t("preview.fields.descriptionHint")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("preview.fields.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
              />
            </FormField>

            {preview.warnings.map((w) => (
              <div key={w} style={s.notice}>
                {w}
              </div>
            ))}

            {preview.ignored_entries.length > 0 && (
              <div>
                <div style={s.sectionLabel}>
                  {t("import.ignored", { count: preview.ignored_entries.length })}
                </div>
                <div style={s.fieldHint}>{t("import.ignoredHint")}</div>
                <ul style={s.ignoredList}>
                  {preview.ignored_entries.map((entry) => (
                    <li key={entry} className="mono">
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div style={s.sectionLabel}>{t("import.bodyPreview", { filename })}</div>
              <div style={s.previewBody}>
                <Markdown>{preview.body}</Markdown>
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
