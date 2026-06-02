"use client";

import React from "react";
import { Icon, Markdown, MonoLink } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { DEFAULT_SECTION_ICON, SECTION_ICON } from "../../constants";
import { s } from "./styles";

export interface SectionCardProps {
  section: OnboardingSection;
  open: boolean;
  onToggle: () => void;
}

/** A single collapsible onboarding section (heading + markdown body + links). */
export function SectionCard({ section, open, onToggle }: SectionCardProps) {
  const I = Icon[SECTION_ICON[section.kind] ?? DEFAULT_SECTION_ICON];
  return (
    <div id={section.kind} style={s.card}>
      <button onClick={onToggle} style={s.button}>
        <div style={s.iconWrap}>
          <I size={15} />
        </div>
        <h3 style={s.title}>{section.title}</h3>
        <Icon.ChevronDown size={16} style={s.chevron(open)} />
      </button>
      {open && (
        <div style={s.body}>
          <div style={s.markdown}>
            <Markdown>{section.body}</Markdown>
          </div>
          {section.diagram && (
            <pre style={s.diagram} className="mono">
              {section.diagram}
            </pre>
          )}
          {section.links.length > 0 && (
            <div style={s.links}>
              {section.links.map((l, i) => (
                <div key={i} style={s.linkRow}>
                  <Icon.FileText size={13} style={s.linkIcon} />
                  <MonoLink>{l.path}</MonoLink>
                  <span style={s.linkLabel}>— {l.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SectionCard;
