import { MultiAgentPage } from "./_components/MultiAgentPage";

/* Route: /repos/:repoId/multi-agent (A5). Thin route entry — the page body,
   its styles, constants and helpers are colocated under _components/MultiAgentPage;
   the MultiAgentView columns/tabs view + RunTraceDrawer are colocated separately. */
export default function Page() {
  return <MultiAgentPage />;
}
