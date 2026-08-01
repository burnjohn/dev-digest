/* PrFindingsCell — the PR list's FINDINGS column.

   The counts ride along on the list payload (one query for the whole page), but
   the findings BEHIND them do not — loading every finding for every PR to
   populate popovers nobody may open would be wasteful. So the reviews are
   fetched only once a counter is opened, under the same query key the PR detail
   page uses, which means opening the PR afterwards is already warm. */
"use client";

import React from "react";
import type { PrMeta } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks";
import { SeverityCounters } from "@/components/severity-counters";
import { countedFindings } from "@/lib/findings";

export function PrFindingsCell({ pr }: { pr: PrMeta }) {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading } = usePrReviews(open ? pr.id : null);

  // Same rule the server used for the counts: the latest review of each agent.
  const findings = React.useMemo(() => (data ? countedFindings(data) : []), [data]);

  return (
    <SeverityCounters
      counts={pr.findings_by_severity}
      findings={findings}
      loading={open && isLoading}
      scope="pr"
      onOpenChange={setOpen}
    />
  );
}

export default PrFindingsCell;
