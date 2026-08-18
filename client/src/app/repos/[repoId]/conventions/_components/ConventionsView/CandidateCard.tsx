/* CandidateCard — one extracted convention: category/rule (editable), the
   verified file:line evidence + real on-disk snippet, a confidence bar, and
   the accept/reject toggle. Accepted cards also carry a checkbox that opts
   them in/out of the "Create skill" bundle (separate from the accept
   decision — see ConventionsView). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, IconBtn, ProgressBar, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function CandidateCard({
  candidate,
  bundleSelected,
  onToggleBundleSelected,
  onAccept,
  onReject,
  onSaveEdit,
  saving,
}: {
  candidate: ConventionCandidate;
  bundleSelected: boolean;
  onToggleBundleSelected: (v: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
  onSaveEdit: (patch: { rule: string; category: string }) => void;
  saving?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [ruleDraft, setRuleDraft] = React.useState(candidate.rule);
  const [categoryDraft, setCategoryDraft] = React.useState(candidate.category);

  const startEdit = () => {
    setRuleDraft(candidate.rule);
    setCategoryDraft(candidate.category);
    setEditing(true);
  };

  const save = () => {
    onSaveEdit({
      rule: ruleDraft.trim() || candidate.rule,
      category: categoryDraft.trim() || candidate.category,
    });
    setEditing(false);
  };

  return (
    <div style={s.card(candidate.accepted)}>
      <div style={s.headerRow}>
        {candidate.accepted && <Checkbox checked={bundleSelected} onChange={onToggleBundleSelected} />}

        {editing ? (
          <div style={s.editFields}>
            <TextInput value={categoryDraft} onChange={setCategoryDraft} placeholder={t("card.categoryLabel")} />
            <TextInput value={ruleDraft} onChange={setRuleDraft} placeholder={t("card.ruleLabel")} />
          </div>
        ) : (
          <div style={s.titleBlock}>
            <span style={s.rule}>{candidate.rule}</span>
          </div>
        )}

        <IconBtn icon="Edit" label={t("card.edit")} onClick={editing ? save : startEdit} active={editing} />
      </div>

      {!editing && <Badge color="var(--text-muted)">{candidate.category}</Badge>}

      <div style={s.evidenceBox}>
        <div style={s.evidencePath} className="mono">
          {candidate.evidence_path}:{candidate.evidence_start_line}-{candidate.evidence_end_line}
        </div>
        <pre style={s.snippet} className="mono">
          {candidate.evidence_snippet}
        </pre>
      </div>

      <div style={s.confidenceRow}>
        <span style={s.confidenceLabel}>{t("card.confidence")}</span>
        <div style={s.confidenceBar}>
          <ProgressBar value={candidate.confidence * 100} />
        </div>
        <span style={s.confidencePct} className="mono tnum">
          {Math.round(candidate.confidence * 100)}%
        </span>
      </div>

      <div style={s.actionsRow}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" icon="Check" onClick={save}>
              {t("card.save")}
            </Button>
            <Button kind="secondary" size="sm" onClick={() => setEditing(false)}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind={candidate.accepted ? "primary" : "secondary"}
              size="sm"
              icon="Check"
              onClick={onAccept}
              disabled={saving}
            >
              {candidate.accepted ? t("card.accepted") : t("card.accept")}
            </Button>
            <Button kind="secondary" size="sm" icon="X" onClick={onReject} disabled={saving}>
              {t("card.reject")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
