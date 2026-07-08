"use client";

import React, { useRef } from "react";
import { useTranslations } from "next-intl";
import { IconBtn, Badge, TextInput, Skeleton } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { s, categoryBadgeColor } from "../../styles";

type T = ReturnType<typeof useTranslations>;

interface Props {
  t: T;
  docs: ContextDocument[];
  filter: string;
  onFilter: (v: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
  onUpload: (file: File) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

/** Left panel of the two-panel Project Context page: toolbar (add / upload /
    refresh — AC-32), filter, and the document list. Row click selects a
    document; the right-hand DocDetail renders it. */
export function DocList({
  t,
  docs,
  filter,
  onFilter,
  selectedPath,
  onSelect,
  onNew,
  onUpload,
  onRefresh,
  isLoading,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    // reset so selecting the same file again re-fires change
    e.target.value = "";
  };

  return (
    <div style={s.leftPanel}>
      <div style={s.toolbarRow}>
        <IconBtn icon="Plus" label={t("toolbar.add")} onClick={onNew} />
        <IconBtn icon="Upload" label={t("toolbar.upload")} onClick={() => fileRef.current?.click()} />
        <span style={s.toolbarSpacer} />
        <IconBtn icon="RefreshCw" label={t("toolbar.refresh")} onClick={onRefresh} />
        <input
          ref={fileRef}
          type="file"
          accept=".md"
          onChange={handleFile}
          style={{ display: "none" }}
          aria-hidden
        />
      </div>

      <div style={s.filterRow}>
        <TextInput value={filter} onChange={onFilter} placeholder={t("filterPlaceholder")} />
      </div>

      <div style={s.listScroll}>
        {isLoading ? (
          <div style={s.skeletonList}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} height={18} />
            ))}
          </div>
        ) : (
          docs.map((doc) => {
            const badge = categoryBadgeColor(doc.category);
            const active = doc.path === selectedPath;
            return (
              <button
                key={doc.path}
                type="button"
                onClick={() => onSelect(doc.path)}
                style={active ? { ...s.listRow, ...s.listRowActive } : s.listRow}
              >
                <div style={s.listRowTop}>
                  <span style={s.listPath} title={doc.path}>
                    {doc.path}
                  </span>
                  <Badge color={badge.color} bg={badge.bg} mono>
                    {doc.category}
                  </Badge>
                </div>
                <div style={s.listRowMeta}>
                  <span className="tnum">{t("table.tokenCountValue", { count: doc.token_count })} tok</span>
                  <span className="tnum">{t("table.usedByValue", { count: doc.used_by_agents })}</span>
                  <span className="tnum">{doc.coverage}%</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
