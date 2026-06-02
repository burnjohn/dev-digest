import { getTranslations } from "next-intl/server";
import { AppShell } from "../../components/app-shell";
import { CiRunsView } from "./_components/CiRuns";

/* Route: /ci-runs. Thin route entry — the view, its styles, constants and test
   are colocated under _components/CiRuns. */
export default async function CiRunsPage() {
  const t = await getTranslations("ci");
  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <CiRunsView />
    </AppShell>
  );
}
