import { EvalsLandingView } from "./_components/EvalsLandingView/EvalsLandingView";

/* Route: /evals (cross-agent Eval Dashboard landing page). Thin route entry
   — the view, its cards, feed, styles, and i18n are colocated under
   _components/EvalsLandingView. */
export default function EvalsPage() {
  return <EvalsLandingView />;
}
