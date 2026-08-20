/* PreviewTab — the skill body rendered the way a reviewing agent receives it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isThirdParty } from "../../../../helpers";
import { s } from "../../../../styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div>
      <div style={s.previewIntro}>
        <h2 style={s.sectionTitle}>{t("editor.tabs.preview")}</h2>
        <p style={s.previewSubtitle}>{t("preview.renderedAs")}</p>
      </div>
      {isThirdParty(skill) && (
        <div style={{ ...s.panel, marginBottom: 14 }}>{t("preview.thirdPartyNotice")}</div>
      )}
      <div style={s.previewCard}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
