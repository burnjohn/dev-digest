/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {/* Keyed by path, not index: FileCard owns per-file UI state (expand,
          comment draft), and an index key would hand that state to a different
          file the moment the list is re-fetched with a file added or removed. */}
      {files.map((f) => (
        <FileCard key={f.path} file={f} commenting={commenting} />
      ))}
    </div>
  );
}
