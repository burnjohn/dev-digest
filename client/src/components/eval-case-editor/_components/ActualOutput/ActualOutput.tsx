/* ActualOutput — REQ-49's "Actual output" region for a skill-owned case.
   Rendered from the ONE seam T20 owns in `EvalCaseEditor.tsx` in place of
   T14's `ActualOutputRegion`, which stays untouched and keeps serving the
   agent arm byte-identically.

   2026-08-29 (owner call): ONE output block. The panel used to render the two
   ablation arms as separate labelled panels with a signed lift row between
   them, which made the comparison — not the findings — the first thing the
   author read. Both arms are still here: they are `"with"` / `"without"`
   SECTIONS inside the single JSON block, exactly as the run persisted them.
   What went is the two-panel chrome and the lift row, whose place is the case
   LIST row and the eval dashboard. `computeSkillLift`/`formatSkillLift` are
   consequently no longer called from here — they remain exported and tested. */
"use client";

import { useTranslations } from "next-intl";
import type { EvalCaseRunResult } from "@devdigest/shared";
import { formatMetricPercent } from "../../helpers";
import { actualOutputView } from "../../skill-helpers";
import { s } from "./styles";

export interface ActualOutputProps {
  run: EvalCaseRunResult | null;
  neverRunYetText: string;
}

export function ActualOutput({ run, neverRunYetText }: ActualOutputProps) {
  const t = useTranslations("eval.caseEditor.actualOutput");

  const output = actualOutputView(run);
  if (!output) return <p style={s.empty}>{neverRunYetText}</p>;

  return (
    <div style={s.wrap}>
      <div style={s.metrics}>
        {t("metricsLine", {
          recall: formatMetricPercent(output.recall),
          precision: formatMetricPercent(output.precision),
          citation: formatMetricPercent(output.citationAccuracy),
        })}
        {" · "}
        {t("findingsCount", { n: output.findingsCount })}
      </div>
      <pre style={s.pre}>{output.json}</pre>
    </div>
  );
}

export default ActualOutput;
