"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Button, FormField, Textarea, SelectInput } from "@devdigest/ui";
import type { MemoryKind, MemoryScope } from "@devdigest/shared";
import type { MemoryDto } from "../../../../lib/hooks/memory";
import { useUpdateMemory, useDeleteMemory } from "../../../../lib/hooks/memory";
import { MEM_KIND, MEM_SCOPE } from "../MemoryCard";
import { KINDS, SCOPES } from "./constants";
import { Stat } from "./_components/Stat";
import { s } from "./styles";

export function MemoryDetail({ m, onClosed }: { m: MemoryDto; onClosed: () => void }) {
  const t = useTranslations("memory");
  const k = MEM_KIND[m.kind];
  const KIcon = Icon[k.icon];
  const update = useUpdateMemory();
  const del = useDeleteMemory();
  const [editing, setEditing] = React.useState(false);
  const [content, setContent] = React.useState(m.content);
  const [kind, setKind] = React.useState<MemoryKind>(m.kind);
  const [scope, setScope] = React.useState<MemoryScope>(m.scope);

  React.useEffect(() => {
    setContent(m.content);
    setKind(m.kind);
    setScope(m.scope);
    setEditing(false);
  }, [m.id, m.content, m.kind, m.scope]);

  const save = async () => {
    await update.mutateAsync({ id: m.id, patch: { content, kind, scope } });
    setEditing(false);
  };
  const remove = async () => {
    await del.mutateAsync(m.id);
    onClosed();
  };

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.kindChip(k.c)}>
          <KIcon size={12} />
          {t(`kind.${m.kind}`)}
        </span>
        <div style={s.headerActions}>
          {!editing && <IconBtn icon="Edit" label={t("detail.edit")} size={26} onClick={() => setEditing(true)} />}
          <IconBtn icon="Trash" label={t("detail.delete")} size={26} danger onClick={remove} />
        </div>
      </div>

      {editing ? (
        <>
          <FormField label={t("detail.contentLabel")}>
            <Textarea value={content} onChange={setContent} rows={5} />
          </FormField>
          <FormField label={t("detail.kindLabel")}>
            <SelectInput value={kind} onChange={(v) => setKind(v as MemoryKind)} options={KINDS} />
          </FormField>
          <FormField label={t("detail.scopeLabel")}>
            <SelectInput value={scope} onChange={(v) => setScope(v as MemoryScope)} options={SCOPES} />
          </FormField>
          <div style={s.editActions}>
            <Button kind="primary" size="sm" icon="Check" onClick={save} disabled={update.isPending}>
              {t("detail.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("detail.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={s.content}>{m.content}</p>
          <div style={s.statRow}>
            <Stat label={t("detail.stat.confidence")} value={`${Math.round(m.confidence * 100)}%`} tnum />
            <Stat label={t("detail.stat.scope")} value={t(`scope.${m.scope}`)} color={MEM_SCOPE[m.scope]} />
            <Stat label={t("detail.stat.updated")} value={new Date(m.updated_at).toLocaleDateString()} />
          </div>
          <div style={s.sectionLabel}>{t("detail.sourceContexts")}</div>
          <div style={s.sourceList}>
            {m.sources.length === 0 && <span style={s.noSources}>{t("detail.noSources")}</span>}
            {m.sources.map((src, i) => (
              <div key={i} style={s.sourceCard}>
                {src.pr != null && (
                  <span className="mono" style={s.prLabel}>
                    {t("detail.prLabel", { pr: src.pr })}
                  </span>
                )}
                <div style={s.sourceContext}>{src.context}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
