/* ConventionCard — one proposed house rule: the rule, its grounded
   `file:line` evidence, a confidence meter derived from how many sampled files
   actually follow it, and the accept / reject / edit controls.

   Structure note: the card is a plain container, NOT a button — it holds three
   buttons of its own, and nesting interactive elements is invalid HTML the
   browser's parser breaks apart (see client/INSIGHTS.md).

   The evidence reference is the point of the card. It names a real line the
   snippet was found on (the server corrects the model's claim before storing it),
   so a user can check the citation in the repo before accepting the rule — which
   is why it links out to the file on github.com at that line range. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, ProgressBar, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useUpdateConvention } from "@/lib/hooks/conventions";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

/** `src/api/users.ts:23-31`, or `…:23` when the evidence is one line. */
export function evidenceRef(c: ConventionCandidate): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = c;
  if (start == null) return path;
  return end == null || end === start ? `${path}:${start}` : `${path}:${start}-${end}`;
}

function meterColor(pct: number): string {
  return pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";
}

export function ConventionCard({
  candidate,
  repoId,
  repoFullName,
  gitRef,
  onAccept,
  onReject,
}: {
  candidate: ConventionCandidate;
  repoId: string;
  /** `owner/repo`. Absent when the repo isn't resolved — the ref stays plain text. */
  repoFullName?: string | null;
  /** Branch or sha the blob link is pinned to (the repo's default branch today). */
  gitRef?: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("conventions");
  const update = useUpdateConvention(repoId);
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [snippet, setSnippet] = React.useState(candidate.evidence_snippet);
  const [copied, setCopied] = React.useState(false);
  const [refHover, setRefHover] = React.useState(false);

  const pct = Math.round((candidate.confidence ?? 0) * 100);
  // `null` is not 0 here: it means no denominator could be measured, which is a
  // different claim from "measured, and nothing violates it".
  const conformance =
    candidate.conformance == null ? null : Math.round(candidate.conformance * 100);
  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const ref = evidenceRef(candidate);
  // Both coordinates or nothing: a half-known repo would build a URL that 404s,
  // which is worse than the plain text it replaces (same rule as `FindingCard`).
  const href =
    repoFullName && gitRef
      ? githubBlobUrl(
          repoFullName,
          gitRef,
          candidate.evidence_path,
          candidate.evidence_start_line ?? undefined,
          candidate.evidence_end_line ?? undefined,
        )
      : undefined;

  const startEdit = () => {
    // Re-seed from the row, so cancelling an edit and reopening doesn't resume
    // the abandoned draft.
    setRule(candidate.rule);
    setSnippet(candidate.evidence_snippet);
    setEditing(true);
  };

  const save = async () => {
    const nextRule = rule.trim();
    if (!nextRule) return;
    await update.mutateAsync({
      id: candidate.id,
      patch: { rule: nextRule, evidence_snippet: snippet },
    });
    setEditing(false);
  };

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard is permission-gated and absent in some browsers; the reference
      // is selectable text either way, so a failure is not worth a toast.
    }
  };

  return (
    <div style={s.card(rejected)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editStack}>
            <div>
              <label htmlFor={`rule-${candidate.id}`} style={s.editLabel}>
                {t("card.ruleLabel")}
              </label>
              <TextInput id={`rule-${candidate.id}`} value={rule} onChange={setRule} />
            </div>
            <div>
              <label htmlFor={`snippet-${candidate.id}`} style={s.editLabel}>
                {t("card.snippetLabel")}
              </label>
              <textarea
                id={`snippet-${candidate.id}`}
                value={snippet}
                onChange={(e) => setSnippet(e.target.value)}
                spellCheck={false}
                style={s.editSnippet}
              />
            </div>
            <div style={s.editActions}>
              <Button
                kind="primary"
                size="sm"
                onClick={save}
                disabled={rule.trim().length === 0 || update.isPending}
              >
                {t("card.save")}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* The category used to be a section heading. The list is ranked by
                confidence now, so it rides here instead — nothing is lost. */}
            <div style={s.chipRow}>
              <span style={s.chip}>{t(`category.${candidate.category ?? "uncategorized"}`)}</span>
              {candidate.config_declared && (
                <span style={s.configChip} title={t("card.configDeclaredTitle")}>
                  <Icon.CheckCircle size={11} aria-hidden="true" /> {t("card.configDeclared")}
                </span>
              )}
            </div>
            <p style={s.rule}>{candidate.rule}</p>
            {candidate.rationale && <p style={s.rationale}>{candidate.rationale}</p>}

            <div style={s.evidenceBox}>
              {/* The link is a SIBLING of the copy button, never its ancestor —
                  nesting interactive elements is invalid HTML (client/INSIGHTS.md).
                  The path text stays the accessible name; `title` carries the
                  "opens on GitHub" hint without overriding it. */}
              <div style={s.evidenceHead}>
                {href ? (
                  <a
                    className="mono"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("card.openOnGitHub")}
                    translate="no"
                    style={s.evidenceLink(refHover)}
                    onMouseEnter={() => setRefHover(true)}
                    onMouseLeave={() => setRefHover(false)}
                  >
                    {ref}
                  </a>
                ) : (
                  <span className="mono" style={s.evidenceRef} translate="no">
                    {ref}
                  </span>
                )}
                <IconBtn
                  icon={copied ? "Check" : "Copy"}
                  label={copied ? t("card.copied") : t("card.copyEvidence")}
                  size={24}
                  onClick={copyRef}
                />
              </div>
              {/* A scrollable region needs to be reachable without a pointer. */}
              <pre style={s.snippet} tabIndex={0} aria-label={t("card.snippetLabel")}>
                {candidate.evidence_snippet}
              </pre>
            </div>

            <div style={s.meterRow}>
              <span style={s.meterLabel}>{t("card.confidence")}</span>
              <div style={s.meterTrack}>
                <ProgressBar value={pct} color={meterColor(pct)} height={5} />
              </div>
              <span className="mono tnum" style={s.meterValue}>
                {pct}%
              </span>
              {/* The measured ratio, when there WAS a denominator. `capped` says the
                  opposite: nothing established how often the rule is broken, so the
                  score is a ceiling rather than a measurement — worth saying out loud
                  next to a meter the user is about to trust. */}
              {conformance !== null ? (
                <span style={s.support}>
                  {t("card.conformance", {
                    pct: conformance,
                    sites: (candidate.follow_count ?? 0) + (candidate.violation_count ?? 0),
                  })}
                </span>
              ) : (
                <span style={s.support} title={t("card.unmeasuredTitle")}>
                  {t("card.unmeasured")}
                </span>
              )}
              <span style={s.support}>{t("card.support", { count: candidate.support_count })}</span>
              {candidate.skill_id && (
                <span style={s.support} title={t("card.shippedIn")}>
                  <Icon.Sparkles size={12} aria-hidden="true" /> {t("card.shippedIn")}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Accept is the card's call to action, so it carries the accent colour
          whether or not it has been pressed — `primary` used to be applied only
          AFTER accepting, which is backwards. Pressed state rides on
          `aria-pressed` + the label instead of on colour alone. */}
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          icon="Check"
          aria-pressed={accepted}
          aria-label={t("card.acceptAria", { rule: candidate.rule })}
          onClick={onAccept}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          aria-pressed={rejected}
          aria-label={t("card.rejectAria", { rule: candidate.rule })}
          onClick={onReject}
        >
          {rejected ? t("card.rejected") : t("card.reject")}
        </Button>
        {!editing && (
          <IconBtn icon="Edit" label={t("card.edit")} size={28} onClick={startEdit} />
        )}
      </div>
    </div>
  );
}
