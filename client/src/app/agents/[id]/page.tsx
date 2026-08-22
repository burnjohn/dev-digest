/* /agents/:id — Agent Editor (A2, L03). Left agent list + Config editor
   (model + system prompt). Tab state lives in ?tab=. Ported from
   screen_agents.jsx. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Dropdown,
  ErrorState,
  Skeleton,
  Icon,
  Badge,
} from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { AgentCard } from "../_components/AgentCard";
import { AgentEditor } from "./_components/AgentEditor";
import { useAgents, useAgent, useUpdateAgent } from "../../../lib/hooks/agents";
import { ApiError } from "../../../lib/api";

const VALID_TABS = ["config", "skills"];

export default function AgentEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: agents } = useAgents();
  const { data: agent, isLoading, isError, error, refetch } = useAgent(id);
  const update = useUpdateAgent();

  const tab = VALID_TABS.includes(search.get("tab") ?? "")
    ? search.get("tab")!
    : "config";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/agents/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: "Skills Lab" },
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "Agent" },
  ];

  if (isError || (!isLoading && !agent)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn’t load this agent"
          body={
            error instanceof ApiError
              ? error.message
              : "The agent could not be loaded."
          }
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: agent list */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Agents</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    Add
                  </Button>
                }
                items={[
                  {
                    label: "Create from scratch",
                    icon: "Edit",
                    onClick: () => router.push("/agents"),
                  },
                ]}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
            {(agents ?? []).map((a) => (
              <AgentCard
                key={a.id}
                ag={a}
                active={a.id === id}
                onClick={() => router.push(`/agents/${a.id}?tab=${tab}`)}
                onToggle={(enabled) =>
                  update.mutate({ id: a.id, patch: { enabled } })
                }
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !agent ? (
          <div
            style={{
              flex: 1,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 28px 0",
                flexShrink: 0,
              }}
            >
              <Icon.Cpu size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{agent.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {agent.provider}/{agent.model}
              </Badge>
              {!agent.enabled && (
                <Badge color="var(--text-muted)">disabled</Badge>
              )}
              <div style={{ marginLeft: "auto" }}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="GitPullRequest"
                  onClick={() => router.push("/")}
                >
                  Run on a PR…
                </Button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <AgentEditor agent={agent} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
