/* CriticalPathsSection — carded rows of [file icon] path — rationale (inline) +
   a bordered "Open" action on the right. The Open action renders ONLY when
   entry.github_link is non-null (AC-8/9); the link is resolved server-side via
   mapGithubLink. No intro body — the design shows only the file rows. */
"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingTourSection } from "@devdigest/shared";
import { s } from "./styles";

export function CriticalPathsSection({ section }: { section: OnboardingTourSection }) {
  const t = useTranslations("onboarding");

  return (
    <ul style={s.list}>
      {section.entries.map((entry, i) => (
        <li key={`${entry.path}-${i}`} style={s.row}>
          <Icon.FileText size={13} style={s.fileIcon} />
          <div style={s.rowMain}>
            <span className="mono" style={s.path}>
              {entry.path}
            </span>
            {entry.rationale && (
              <span style={s.rationale}>
                <span style={s.dash}>—</span>
                {entry.rationale}
              </span>
            )}
          </div>
          {entry.github_link && (
            <a
              href={entry.github_link}
              target="_blank"
              rel="noopener noreferrer"
              style={s.openAction}
            >
              {t("openAction")}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
