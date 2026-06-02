/* DiffViewer.tsx — basic GitHub-style unified diff viewer.
   Ported from prototype diff.jsx, generalized to render real PrFile.patch
   (unified-diff text from the F1 API). Per-file collapse, +/- gutters, hunks.
   Smart-Diff grouping + finding markers are A3/A2; this is the plain viewer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "../../lib/types";
import { AUTO_EXPAND_MAX_LINES } from "./constants";
import { parsePatch, type Line } from "./helpers";
import { s, chevronFor, lineRowFor, lineSignFor } from "./styles";

function FileCard({ file }: { file: PrFile }) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => <CodeLine key={i} ln={ln} />)
          )}
        </div>
      )}
    </div>
  );
}

function CodeLine({ ln }: { ln: Line }) {
  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }
  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  return (
    <div style={lineRowFor(ln.kind)}>
      <span className="mono tnum" style={s.lineNo}>
        {ln.newNo ?? ln.oldNo ?? ""}
      </span>
      <span className="mono" style={lineSignFor(ln.kind)}>
        {sign}
      </span>
      <span className="mono" style={s.lineText}>
        {ln.text || " "}
      </span>
    </div>
  );
}

export function DiffViewer({ files }: { files: PrFile[] }) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard key={i} file={f} />
      ))}
    </div>
  );
}
