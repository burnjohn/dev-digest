import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance (L08 optional homework). Workspace-wide — no
   :repoId/:id token. Thin route entry — the view, styles, helpers and i18n
   are colocated under _components/AgentPerformanceView, mirroring the
   /ci-runs page's shape. */
export default function AgentPerformancePage() {
  return <AgentPerformanceView />;
}
