/* Route: /evals — cross-agent Eval Dashboard (T10, SPEC-03 AC-20).

   Static route (no dynamic segment) — no useParams() needed here.
   The view (EvalDashboardView) is a client component that handles data fetching
   and renders the agent cards with metrics, recent runs, and the Compare modal.

   Note: The left-sidebar NAV entry for this page lives in vendored @devdigest/ui
   (do-not-touch). The /evals route is reachable by URL and via in-app links from
   the AgentEditor Evals tab — see PLAN-03 Risks section for the nav gap. */

import { EvalDashboardView } from "./_components/EvalDashboardView";

export default function EvalsPage() {
  return <EvalDashboardView />;
}
