/* PreviewTab — the skill's body, rendered exactly as it reaches the model:
   as markdown instructions, not as quoted/fenced data (see
   specs/01-skills.md — a skill body is never `<untrusted>`-wrapped). */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div>
      <h2 style={s.title}>{t("previewTab.title")}</h2>
      <p style={s.subtitle}>{t("previewTab.subtitle")}</p>
      <div style={s.body}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
