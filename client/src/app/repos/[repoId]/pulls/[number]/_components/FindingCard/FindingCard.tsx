/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, lethal-trifecta venn, accept/dismiss/learn/reply actions, and a
   reply composer. Accept/dismiss reflect persisted timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  Textarea,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { TrifectaVenn } from "../TrifectaVenn";
import { REPLY_ROWS, SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [replying, setReplying] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          {f.kind === "lethal_trifecta" && f.trifecta_components && (
            <div style={s.trifectaWrap}>
              <TrifectaVenn components={f.trifecta_components} />
            </div>
          )}
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Brain"
              disabled={pending}
              onClick={() => onAction?.("learn")}
            >
              {t("finding.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="MessageSquare"
              disabled={pending}
              onClick={() => setReplying((r) => !r)}
            >
              {t("finding.replyToAuthor")}
            </Button>
          </div>

          {replying && (
            <div style={s.composer}>
              <Textarea
                value={replyText}
                onChange={setReplyText}
                rows={REPLY_ROWS}
                placeholder={t("finding.replyPlaceholder")}
              />
              <div style={s.composerActions}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="MessageSquare"
                  disabled={pending || !replyText.trim()}
                  onClick={() => {
                    onAction?.("reply", replyText.trim());
                    setReplyText("");
                    setReplying(false);
                  }}
                >
                  {t("finding.sendReply")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => setReplying(false)}>
                  {t("finding.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
