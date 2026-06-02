/* AgentCiTab — A4 default-export for the Agent Editor "CI" tab.
   Shows existing CI installations for the agent + an "Export to CI" button that
   opens the 4-step wizard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, MonoLink } from "@devdigest/ui";
import { useCiInstallations } from "../../../../../lib/hooks/ci";
import { ExportWizard } from "../../../../ci-runs/_components/ExportWizard";
import { s } from "./styles";

export function AgentCiTab({
  agentId,
  agentName,
  defaultRepo,
}: {
  agentId: string;
  agentName?: string;
  defaultRepo?: string;
}) {
  const t = useTranslations("ci");
  const { data: installs } = useCiInstallations();
  const [wizard, setWizard] = React.useState(false);
  const mine = (installs ?? []).filter((i) => i.agent_id === agentId);

  return (
    <div>
      {wizard && (
        <ExportWizard
          agentId={agentId}
          agentName={agentName}
          defaultRepo={defaultRepo ?? ""}
          onClose={() => setWizard(false)}
        />
      )}

      <div style={s.header}>
        <div>
          <h3 style={s.heading}>{t("ciTab.heading")}</h3>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <div style={s.actions}>
          <Button kind="primary" size="sm" icon="Workflow" onClick={() => setWizard(true)}>
            {t("ciTab.exportToCi")}
          </Button>
        </div>
      </div>

      {mine.length === 0 ? (
        <div style={s.empty}>{t("ciTab.empty")}</div>
      ) : (
        <div style={s.list}>
          {mine.map((i) => (
            <div key={i.id} style={s.installRow}>
              <Icon.Workflow size={16} style={s.installIcon} />
              <div style={s.installBody}>
                <MonoLink>{i.repo}</MonoLink>
                <div style={s.installedAt}>
                  {t("ciTab.installed", { date: new Date(i.installed_at).toLocaleDateString() })}
                </div>
              </div>
              <Badge color="var(--text-secondary)" icon="Workflow">
                {i.target_type}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentCiTab;
