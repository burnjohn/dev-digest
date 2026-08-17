/* /repos/:repoId/conventions — thin route entry. All logic lives in the
   colocated view, matching /skills. */
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  return <ConventionsView />;
}
