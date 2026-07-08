/* HowToRunSection — numbered list of shell commands from `entries`, each
   copyable via a clipboard IconBtn. Copy-to-clipboard micro-pattern mirrors
   PromptBlock.tsx (navigator.clipboard.writeText + a 1.2s "copied" flip). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingTourSection } from "@devdigest/shared";
import { s } from "./styles";

function CommandRow({ index, command }: { index: number; command: string }) {
  const t = useTranslations("onboarding");
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <li style={s.row}>
      <span style={s.index}>{index}</span>
      <code className="mono" style={s.command}>
        {command}
      </code>
      <button
        type="button"
        title={copied ? t("commandCopied") : t("copyCommand")}
        aria-label={copied ? t("commandCopied") : t("copyCommand")}
        onClick={copy}
        style={s.copyBtn}
      >
        {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
      </button>
    </li>
  );
}

export function HowToRunSection({ section }: { section: OnboardingTourSection }) {
  return (
    <ol style={s.list}>
      {section.entries.map((entry, i) => (
        <CommandRow key={`${entry.path}-${i}`} index={i + 1} command={entry.path} />
      ))}
    </ol>
  );
}
