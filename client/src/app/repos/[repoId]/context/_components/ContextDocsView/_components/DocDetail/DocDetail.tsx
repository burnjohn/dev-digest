"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, IconBtn, Skeleton, Textarea, CircularScore, TextInput } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { useContextDocContent, useSaveContextDoc, useDeleteContextDoc } from "@/lib/hooks/context-docs";
import { DocPreviewPane } from "../DocPreviewPane";
import { s, categoryBadgeColor } from "../../styles";

type T = ReturnType<typeof useTranslations>;

interface Props {
  t: T;
  repoId: string;
  /** The selected document path; `""` = an unsaved new document (create/upload). */
  selectedPath: string;
  /** List-entry metadata for the selected doc (coverage/used_by/source). Absent for a new doc. */
  doc: ContextDocument | undefined;
  /** Initial path/body for a new (unsaved) document — from the `+` button or an upload. */
  seed?: { path: string; body: string };
  onSaved: (path: string) => void;
  onDeleted: () => void;
}

/** Right panel: Preview/Edit toggle, coverage ring + used-by (AC-28/AC-29),
    Save (overlay upsert, AC-24), Delete (overlay-only, gated on source, AC-34).
    Keyed on `selectedPath` by the parent so local draft state resets cleanly on
    selection change (no re-sync useEffect). */
export function DocDetail({ t, repoId, selectedPath, doc, seed, onSaved, onDeleted }: Props) {
  const isNew = selectedPath === "";
  const [mode, setMode] = useState<"preview" | "edit">(isNew ? "edit" : "preview");
  const [pathDraft, setPathDraft] = useState(seed?.path ?? "");
  const [draft, setDraft] = useState<string | null>(isNew ? seed?.body ?? "" : null);
  const [pathError, setPathError] = useState(false);

  const content = useContextDocContent(repoId, isNew ? null : selectedPath);
  const save = useSaveContextDoc(repoId);
  const del = useDeleteContextDoc(repoId);

  const effective = draft ?? content.data?.content ?? "";

  const handleSave = () => {
    const path = isNew ? pathDraft.trim() : selectedPath;
    if (!path) {
      setPathError(true);
      return;
    }
    setPathError(false);
    save.mutate(
      { path, body: draft ?? content.data?.content ?? "" },
      { onSuccess: () => { onSaved(path); setMode("preview"); } },
    );
  };

  const handleDelete = () => {
    if (!doc || doc.source === "clone") return;
    const msg = doc.source === "overlay" ? t("detail.deleteConfirmRevert") : t("detail.deleteConfirmRemove");
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    del.mutate({ path: selectedPath }, { onSuccess: onDeleted });
  };

  const badge = doc ? categoryBadgeColor(doc.category) : null;
  const canDelete = !!doc && doc.source !== "clone";

  return (
    <div style={s.detailPanel}>
      <div style={s.detailHeader}>
        <div style={s.detailPathCol}>
          <span style={s.detailPath} title={isNew ? undefined : selectedPath}>
            {isNew ? t("detail.newDocumentTitle") : selectedPath}
          </span>
          <div style={s.detailMetaRow}>
            {doc && badge && (
              <Badge color={badge.color} bg={badge.bg} mono>
                {doc.category}
              </Badge>
            )}
            {doc && <span>{t("detail.usedByLabel", { count: doc.used_by_agents })}</span>}
          </div>
        </div>

        {!isNew && (
          <div style={s.modeToggle} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "preview"}
              onClick={() => setMode("preview")}
              style={mode === "preview" ? { ...s.modeBtn, ...s.modeBtnActive } : s.modeBtn}
            >
              {t("detail.preview")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              onClick={() => setMode("edit")}
              style={mode === "edit" ? { ...s.modeBtn, ...s.modeBtnActive } : s.modeBtn}
            >
              {t("detail.edit")}
            </button>
          </div>
        )}

        {doc && (
          <div style={s.coverageWrap}>
            <CircularScore score={doc.coverage} size={44} />
            <span style={s.coverageLabel}>{t("detail.coverageLabel")}</span>
          </div>
        )}
      </div>

      <div style={s.detailBody}>
        {isNew && (
          <div style={s.pathInputRow}>
            <TextInput
              value={pathDraft}
              onChange={setPathDraft}
              placeholder={t("detail.newDocumentPathPlaceholder")}
              mono
            />
            {pathError && <div style={s.validationMsg}>{t("detail.unsavedPathRequired")}</div>}
          </div>
        )}

        {!isNew && content.isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={14} width="90%" />
            <Skeleton height={14} width="75%" />
            <Skeleton height={14} width="82%" />
          </div>
        ) : !isNew && content.isError ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("detail.loadError")}</p>
        ) : mode === "edit" ? (
          <Textarea value={effective} onChange={setDraft} rows={18} mono />
        ) : (
          <DocPreviewPane content={effective} />
        )}
      </div>

      <div style={s.detailFooter}>
        {canDelete && (
          <Button kind="secondary" size="sm" icon="Trash" onClick={handleDelete} disabled={del.isPending}>
            {t("detail.delete")}
          </Button>
        )}
        <span style={s.detailFooterSpacer} />
        {(mode === "edit" || isNew) && (
          <Button kind="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? t("detail.saving") : t("detail.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
