/* MarkdownEditor — monospace textarea with a line-number gutter, an unsaved
   chip, and a token estimate. No syntax highlighting: that needs a highlighter
   dependency plus a transparent-textarea overlay, and the overlay is what breaks
   IME input and mobile selection. Line numbers + monospace is the honest
   version of the mockup.

   Shared: the skill editor's Config tab and the create-skill-from-conventions
   modal both edit a skill body, so this was promoted out of the skills route on
   its second consumer. It still reads the `skills` i18n namespace for its two
   chrome labels (`editor.unsaved`, `editor.tokens`) — moving those keys would
   churn the skills tests for no user-visible gain. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { estimateTokens, lineNumbers, skillFileName } from "./helpers";
import { MAX_SKILL_BODY_CHARS } from "./constants";
import { s } from "./styles";

export function MarkdownEditor({
  name,
  value,
  onChange,
  dirty,
  id,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  dirty: boolean;
  id?: string;
}) {
  const t = useTranslations("skills");
  const [scrollTop, setScrollTop] = React.useState(0);
  const lines = lineNumbers(value);
  const over = value.length > MAX_SKILL_BODY_CHARS;

  return (
    <div style={s.wrap}>
      <div style={s.headerStrip}>
        <span className="mono" style={s.fileName}>
          {skillFileName(name)}
        </span>
        {dirty && <span style={s.unsaved}>{t("editor.unsaved")}</span>}
        <span style={over ? s.tokensOver : s.tokens}>
          {t("editor.tokens", { count: estimateTokens(value) })}
        </span>
      </div>
      <div style={s.body}>
        <div style={s.gutter} aria-hidden="true">
          <div style={s.gutterInner(scrollTop)}>
            {lines.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        </div>
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          spellCheck={false}
          style={s.textarea}
        />
      </div>
    </div>
  );
}
