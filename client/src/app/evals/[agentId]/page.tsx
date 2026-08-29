/* /evals/:agentId — thin route entry. All logic lives in the colocated
   drill-in view; this only reads the route param. */
"use client";

import { useParams } from "next/navigation";
import { AgentDrillIn } from "../_components/AgentDrillIn";

export default function EvalAgentDrillInPage() {
  const params = useParams<{ agentId: string }>();
  return <AgentDrillIn agentId={params.agentId} />;
}
