/* /repos/:repoId/context — thin route entry. All logic lives in the
   colocated view, matching /conventions and /skills. */
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ContextPage() {
  return <ProjectContextView />;
}
