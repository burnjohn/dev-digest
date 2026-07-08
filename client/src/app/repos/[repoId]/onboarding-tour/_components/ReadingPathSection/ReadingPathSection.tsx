/* ReadingPathSection — numbered list ordered EXACTLY as the server returned
   `entries` (AC-7 is a server-side invariant, enforced by attachRankOrder on
   the server). This component NEVER sorts, reverses, or re-orders `entries`
   in any way — it maps the array as-is, in index order. No intro body — the
   design shows only the numbered file rows. */
"use client";

import type { OnboardingTourSection } from "@devdigest/shared";
import { s } from "./styles";

export function ReadingPathSection({ section }: { section: OnboardingTourSection }) {
  return (
    <ol style={s.list}>
      {section.entries.map((entry, i) => (
        <li key={`${entry.path}-${i}`} style={s.row}>
          <span style={s.index}>{i + 1}</span>
          <div style={s.rowMain}>
            <span className="mono" style={s.path}>
              {entry.path}
            </span>
            <p style={s.rationale}>{entry.rationale}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
