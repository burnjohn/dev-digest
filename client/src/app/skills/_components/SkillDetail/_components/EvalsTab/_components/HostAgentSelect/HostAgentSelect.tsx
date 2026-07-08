"use client";

/* HostAgentSelect — presentational host-agent picker for the skill Evals tab
   (Step 9 of docs/plans/2026-07-06-skill-eval-pipeline.md, AC-11).

   Fully controlled: `value`/`onChange` only, no internal selected-state beyond
   the one-time "apply the default" effect below. Default resolution order:
     1. the agent named exactly "General Reviewer" (case-sensitive), if present
     2. otherwise the first agent returned by `useAgents()`
     3. zero agents → render a disabled selector with an explicit empty message
        (the parent keeps "Run all evals" disabled by never receiving a value).

   NOT wrapped in a raw <label>: per client/insights.md's 2026-07-06 Mistake
   entry, the custom SelectInput self-selects option[0] the instant a raw
   <label> ancestor re-dispatches the click to its first labelable descendant.
   Use a <div> + <span> caption instead (same fix already applied in
   CaseEditor.tsx's expectation-type select). */

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";

const GENERAL_REVIEWER_NAME = "General Reviewer";

interface HostAgentSelectProps {
  value: string | null;
  onChange: (agentId: string) => void;
}

export function HostAgentSelect({ value, onChange }: HostAgentSelectProps) {
  const t = useTranslations("skills");
  const { data: agents } = useAgents();
  const list = agents ?? [];

  // One-time default-application effect (AC-11): only fires while nothing is
  // selected yet, and only once the agent list is available. Does not hold
  // any state of its own — it simply calls the controlling parent's onChange.
  React.useEffect(() => {
    if (value != null) return;
    if (list.length === 0) return;
    const general = list.find((a) => a.name === GENERAL_REVIEWER_NAME);
    const fallback = list[0];
    const defaultAgent = general ?? fallback;
    if (defaultAgent) onChange(defaultAgent.id);
    // Only re-run when the resolved candidate set changes — `value`/`onChange`
    // are intentionally excluded so this stays a one-time default, not a
    // re-assertion loop every time the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((a) => a.id).join(",")]);

  if (list.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evals.hostAgent.label")}</span>
        <SelectInput value="" options={[{ value: "", label: t("evals.hostAgent.noAgents") }]} mono={false} />
      </div>
    );
  }

  const options = list.map((a) => ({ value: a.id, label: a.name }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evals.hostAgent.label")}</span>
      <SelectInput value={value ?? ""} onChange={onChange} options={options} mono={false} />
    </div>
  );
}
