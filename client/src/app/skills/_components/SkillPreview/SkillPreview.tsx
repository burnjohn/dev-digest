"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle, Markdown, FormField, Textarea, Button } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../lib/hooks/skills";
import { isUntrusted } from "./helpers";
import { s } from "./styles";

/** Center pane: skill body preview + enable toggle + lightweight body editor. */
export function SkillPreview({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(skill.body);

  React.useEffect(() => {
    setDraft(skill.body);
    setEditing(false);
  }, [skill.id, skill.body]);

  const save = async () => {
    await update.mutateAsync({ id: skill.id, patch: { body: draft } });
    setEditing(false);
  };

  const untrusted = isUntrusted(skill.source);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        <Badge color="var(--text-muted)">{t("preview.version", { version: skill.version })}</Badge>
        {untrusted && (
          <Badge color="var(--warn)" bg="transparent" dot>
            {t("preview.untrustedBadge")}
          </Badge>
        )}
        <div style={s.headerActions}>
          <span style={s.enabledLabel}>{skill.enabled ? t("preview.enabled") : t("preview.disabled")}</span>
          <Toggle
            on={skill.enabled}
            onChange={(v) => update.mutate({ id: skill.id, patch: { enabled: v } })}
            size={15}
          />
          {editing ? (
            <Button kind="secondary" size="sm" icon="Check" onClick={save} disabled={update.isPending}>
              {t("preview.save")}
            </Button>
          ) : (
            <Button kind="ghost" size="sm" icon="Edit" onClick={() => setEditing(true)}>
              {t("preview.edit")}
            </Button>
          )}
        </div>
      </div>

      <div style={s.body}>
        {untrusted && (
          <div style={s.untrustedNotice}>
            <Icon.Shield size={15} style={s.shieldIcon} />
            <span>{t("preview.untrustedNotice")}</span>
          </div>
        )}
        {editing ? (
          <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
            <Textarea value={draft} onChange={setDraft} rows={20} mono />
          </FormField>
        ) : (
          <Markdown>{skill.body}</Markdown>
        )}
      </div>
    </div>
  );
}
