"use client";

/* Route: /evals/[agentId] (per-agent Eval Dashboard detail page). Matches
   every other `agents/[id]`-style page's convention — "use client" at the
   page level, `useParams()` (NOT the one-off async-Server-Component pattern
   used by the Project Context page). Reads an optional `?batch=` query param
   so a row clicked on the landing page's recent-runs feed can pre-expand the
   matching Batch History row on arrival (AC-10). `useSearchParams()` returns
   `null` in jsdom test environments, hence the `?.get(...)` guard. */

import { useParams, useSearchParams } from "next/navigation";
import { EvalDetailView } from "../_components/EvalDetailView/EvalDetailView";

export default function EvalDetailPage() {
  const params = useParams<{ agentId: string }>();
  const searchParams = useSearchParams();
  const preselectBatchId = searchParams?.get("batch") ?? null;

  return <EvalDetailView agentId={params.agentId} preselectBatchId={preselectBatchId} />;
}
