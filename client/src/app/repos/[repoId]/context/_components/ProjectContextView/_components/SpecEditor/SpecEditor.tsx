"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Card, Markdown, Textarea, ErrorState, Skeleton } from "@devdigest/ui";
import { useSpecFile, useSaveSpec } from "../../../../../../../../lib/hooks/context";
import { SPEC_MODES, type SpecMode } from "../../constants";
import { s } from "./styles";

export interface SpecEditorProps {
  repoId: string;
  path: string;
  mode: SpecMode;
  onMode: (m: SpecMode) => void;
}

/** Read / edit a single spec file (preview markdown · edit textarea + save). */
export function SpecEditor({ repoId, path, mode, onMode }: SpecEditorProps) {
  const t = useTranslations("context");
  const { data, isLoading, isError, error } = useSpecFile(repoId, path);
  const save = useSaveSpec(repoId);
  const [draft, setDraft] = React.useState<string>("");

  React.useEffect(() => {
    if (data?.content != null) setDraft(data.content);
  }, [data?.content]);

  if (isLoading) return <Skeleton height={300} />;
  if (isError || !data) {
    return <ErrorState title={t("editor.loadError")} body={(error as Error)?.message ?? ""} />;
  }

  return (
    <Card>
      <div style={s.header}>
        <Icon.FileText size={15} style={s.icon} />
        <span className="mono" style={s.path}>
          {path}
        </span>
        <div style={s.modeToggle}>
          {SPEC_MODES.map((m) => (
            <button key={m} onClick={() => onMode(m)} style={s.modeBtn(mode === m)}>
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === "edit" && (
          <Button
            kind="primary"
            size="sm"
            icon="Check"
            disabled={save.isPending || draft === data.content}
            onClick={() => save.mutate({ path, content: draft })}
          >
            {save.isPending ? t("editor.saving") : t("editor.save")}
          </Button>
        )}
      </div>
      {mode === "edit" ? (
        <Textarea value={draft} onChange={(v) => setDraft(v)} rows={20} mono />
      ) : (
        <div style={s.markdown}>
          <Markdown>{data.content}</Markdown>
        </div>
      )}
    </Card>
  );
}

export default SpecEditor;
