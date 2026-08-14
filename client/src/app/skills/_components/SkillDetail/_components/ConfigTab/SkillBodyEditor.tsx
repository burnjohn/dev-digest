/* SkillBodyEditor — a line-numbered gutter over a plain <textarea>.
   No dependency, no syntax highlighting: a skill body is markdown prose, not
   code, and a gutter is what the mockup actually asks for. The gutter and the
   textarea are two elements kept in sync by mirroring scrollTop on scroll. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { estimateTokens } from "../../../SkillsListView/helpers";
import { s } from "./styles";

export function SkillBodyEditor({
  filename,
  value,
  onChange,
  unsaved,
  rows = 18,
}: {
  filename: string;
  value: string;
  onChange: (v: string) => void;
  unsaved: boolean;
  rows?: number;
}) {
  const t = useTranslations("skills");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lineCount = value.length === 0 ? 1 : value.split("\n").length;

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  return (
    <div>
      <div style={s.editorBar}>
        <span className="mono" style={s.filename}>
          {filename}
        </span>
        {unsaved && <Badge color="var(--warn)">{t("config.unsaved")}</Badge>}
        <div style={s.spacer} />
        <span className="tnum" style={s.tokenCount} title={t("config.tokenEstimateHint")}>
          {t("config.tokenCount", { count: estimateTokens(value) })}
        </span>
      </div>
      <div style={s.editorBody}>
        {/* No explicit height on either child: `editorBody` is a row flex
            container, so both stretch to the tallest one — the textarea, sized
            by its `rows` attribute. The gutter clips to that height and scrolls
            in step with the textarea via `syncScroll`. */}
        <div ref={gutterRef} className="mono tnum" style={s.gutter}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          rows={rows}
          spellCheck={false}
          wrap="off"
          style={s.textarea}
        />
      </div>
    </div>
  );
}
