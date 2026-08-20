/* ConventionCard — one extracted house-rule with its verified evidence and the
   accept / reject / edit controls. The snippet shown is the repo's own bytes:
   the server drops any candidate whose evidence it could not find in the file. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  IconBtn,
  ProgressBar,
  TextInput,
  Textarea,
} from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { confidenceColor, evidenceLabel } from "../../helpers";
import { s } from "../../styles";

export interface ConventionCardProps {
  candidate: ConventionCandidate;
  busy?: boolean;
  /** Deep link to the evidence on GitHub; plain text when null. */
  evidenceHref?: string | null;
  /** Accepted candidates are selectable — the selection is what a skill is built from. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onStatus: (status: ConventionStatus) => void;
  onSave: (patch: { rule: string; rationale: string | null }) => void;
  onDelete: () => void;
}

export function ConventionCard({
  candidate,
  busy = false,
  evidenceHref = null,
  selectable = false,
  selected = false,
  onSelect,
  onStatus,
  onSave,
  onDelete,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [rationale, setRationale] = React.useState(candidate.rationale ?? "");

  const startEdit = () => {
    setRule(candidate.rule);
    setRationale(candidate.rationale ?? "");
    setEditing(true);
  };

  const save = () => {
    onSave({ rule: rule.trim(), rationale: rationale.trim() || null });
    setEditing(false);
  };

  const pct = Math.round(candidate.confidence * 100);

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.cardMain}>
        <div style={s.cardTitleRow}>
          {selectable && (
            <Checkbox
              checked={selected}
              onChange={(v) => onSelect?.(v)}
              label={t("card.includeInSkill")}
            />
          )}
          <Badge mono>{t(`card.category.${candidate.category}`)}</Badge>
          {!editing && <div style={s.rule}>{candidate.rule}</div>}
        </div>

        {editing ? (
          <>
            <TextInput value={rule} onChange={setRule} placeholder={t("card.ruleLabel")} />
            <div style={{ height: 10 }} />
            <Textarea
              value={rationale}
              onChange={setRationale}
              rows={3}
              placeholder={t("card.rationaleLabel")}
            />
            <div style={s.editRow}>
              <Button kind="primary" size="sm" onClick={save} disabled={rule.trim().length === 0}>
                {t("card.save")}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {candidate.rationale && <p style={s.rationale}>{candidate.rationale}</p>}
            <div style={s.evidence}>
              <div style={s.evidenceHeader}>
                {evidenceHref ? (
                  // Opens the exact line on GitHub. The snippet below stays the
                  // authoritative evidence — the link can drift if the file moves
                  // after the scan, the verified snippet cannot.
                  <a
                    className="mono"
                    href={evidenceHref}
                    target="_blank"
                    rel="noreferrer"
                    title={t("card.openOnGitHub")}
                    style={s.evidenceLink}
                  >
                    {evidenceLabel(candidate.evidence_path, candidate.evidence_line)}
                    <Icon.ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono">
                    {evidenceLabel(candidate.evidence_path, candidate.evidence_line)}
                  </span>
                )}
              </div>
              <pre className="mono" style={s.evidenceCode}>
                {candidate.evidence_snippet}
              </pre>
            </div>
            <div style={s.confidenceRow}>
              <span>{t("card.confidence")}</span>
              <div style={s.confidenceBar}>
                <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} />
              </div>
              <span className="mono tnum">{pct}%</span>
            </div>
          </>
        )}
      </div>

      <div style={s.actions}>
        <Button
          kind={candidate.status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          disabled={busy}
          onClick={() => onStatus(candidate.status === "accepted" ? "pending" : "accepted")}
        >
          {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={busy}
          onClick={() => onStatus(candidate.status === "rejected" ? "pending" : "rejected")}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <IconBtn icon="Edit" label={t("card.edit")} onClick={startEdit} />
          <IconBtn icon="Trash" label={t("card.delete")} onClick={onDelete} />
        </div>
      </div>
    </div>
  );
}
