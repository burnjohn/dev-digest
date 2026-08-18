/* InlineComposer — shared inline comment composer (new comment or reply to a
   thread). Posts live to GitHub via the DiffCommentApi. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Textarea, Button } from "@devdigest/ui";
import { cs, type DiffCommentApi } from "../comments";

export function InlineComposer({
  commenting,
  path,
  line,
  side,
  inReplyTo,
  onClose,
}: {
  commenting: DiffCommentApi;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  inReplyTo?: number;
  onClose: () => void;
}) {
  const t = useTranslations("shell");
  const [text, setText] = React.useState("");
  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await commenting.onSubmit({
        path,
        line,
        side,
        body,
        ...(inReplyTo != null ? { in_reply_to: inReplyTo } : {}),
      });
      setText("");
      onClose();
    } catch {
      /* error toast is raised by the caller; keep the draft open */
    }
  };
  return (
    /* `presentation`: the wrapper is not a control, it only delegates the two
       shortcuts (Esc / ⌘+Enter) for whichever child — textarea or button —
       holds focus. Those children carry the keyboard affordance themselves. */
    <div
      role="presentation"
      style={cs.thread}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
      }}
    >
      <Textarea
        value={text}
        onChange={setText}
        rows={3}
        placeholder={t("diffViewer.commentPlaceholder")}
      />
      <div style={cs.composerActions}>
        <Button
          kind="primary"
          size="sm"
          icon="MessageSquare"
          loading={commenting.posting}
          disabled={commenting.posting || !text.trim()}
          onClick={() => void submit()}
        >
          {t("diffViewer.post")}
        </Button>
        <Button kind="ghost" size="sm" onClick={onClose} disabled={commenting.posting}>
          {t("diffViewer.cancel")}
        </Button>
        <span style={cs.hint}>{t("diffViewer.postedToGitHub")}</span>
      </div>
    </div>
  );
}
