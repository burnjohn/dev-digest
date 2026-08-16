/* /skills/:id — thin route entry. The rail + header + tabbed editor live in the
   colocated detail view, so this page stays free of logic. */
import { SkillDetailView } from "./_components/SkillDetailView";

export default function SkillDetailPage() {
  return <SkillDetailView />;
}
