/* ArchitectureSection — renders the architecture overview's narrative body as
   markdown (reusing the project's existing Markdown primitive, same renderer as
   IntentCard/VerdictBanner) plus the mermaid diagram rendered to an inline SVG
   via MermaidDiagram (graceful raw-source fallback on render failure). */
"use client";

import { Markdown } from "@devdigest/ui";
import type { OnboardingTourSection } from "@devdigest/shared";
import { MermaidDiagram } from "./MermaidDiagram";
import { s } from "./styles";

export function ArchitectureSection({ section }: { section: OnboardingTourSection }) {
  return (
    <div style={s.wrap}>
      <Markdown>{section.body}</Markdown>
      {section.diagram && (
        <div style={s.diagramWrap}>
          <MermaidDiagram chart={section.diagram} />
        </div>
      )}
    </div>
  );
}
