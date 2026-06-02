import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions. Thin route entry — the view, its styles and
   the ConventionCard component are colocated under _components/. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
