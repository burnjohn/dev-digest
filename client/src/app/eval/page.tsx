import { getTranslations } from "next-intl/server";
import { AppShell } from "../../components/app-shell";
import { EvalDashboard } from "./_components/EvalDashboard";

/* Route: /eval. Thin route entry — the view, its styles, constants, helpers and
   test are colocated under _components/EvalDashboard. */
export default async function EvalDashboardPage() {
  const t = await getTranslations("eval");
  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <EvalDashboard />
    </AppShell>
  );
}
