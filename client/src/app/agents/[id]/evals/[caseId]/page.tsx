"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "../../../../../components/app-shell";
import { EvalCaseEditor } from "./_components/EvalCaseEditor";
import { s } from "./styles";

const NEW_CASE = "new";

export default function EvalCaseEditorPage() {
  const t = useTranslations("eval");
  const { id, caseId } = useParams<{ id: string; caseId: string }>();
  const router = useRouter();

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbAgents"), href: "/agents" },
        { label: t("page.crumbEvals"), href: `/agents/${id}?tab=evals` },
        { label: caseId === NEW_CASE ? t("page.crumbNewCase") : t("page.crumbEvalCase") },
      ]}
    >
      <div style={s.wrap}>
        <EvalCaseEditor
          agentId={id}
          caseId={caseId}
          onSaved={(savedId) => {
            if (caseId === NEW_CASE) router.replace(`/agents/${id}/evals/${savedId}`);
          }}
        />
      </div>
    </AppShell>
  );
}
