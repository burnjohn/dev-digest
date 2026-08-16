"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/**
 * Preview tab — the skill body rendered the way a human reads it.
 *
 * Note what this is NOT: the model receives the raw markdown source, not this
 * rendering. The subtitle says "as the reviewing agent receives it" because the
 * CONTENT is identical and verbatim — the body is injected into the prompt's
 * `## Skills / rules` section with no wrapping and no transformation. To see the
 * literal assembled prompt, open the Run Trace drawer on a review.
 */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("editor.preview.heading")}</h2>
      <p style={s.subtitle}>{t("editor.preview.subtitle")}</p>
      <div style={s.card}>
        {skill.body.trim() ? (
          <Markdown>{skill.body}</Markdown>
        ) : (
          <p style={s.empty}>{t("editor.preview.empty")}</p>
        )}
      </div>
    </div>
  );
}
