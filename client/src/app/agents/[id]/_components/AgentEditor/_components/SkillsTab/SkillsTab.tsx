/* SkillsTab — attach, order and toggle the skills an agent sends with its prompt.
   Row order IS prompt order; a change here bumps the agent's config version. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { TYPE_COLORS } from "./constants";
import {
  buildRows,
  countActive,
  detachRow,
  filterRows,
  moveRow,
  toPayload,
  toggleRow,
  type SkillRowState,
} from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const toast = useToast();
  const all = useSkills();
  const linked = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const [rows, setRows] = React.useState<SkillRowState[]>([]);
  const [query, setQuery] = React.useState("");
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  // Rebuild from the server whenever either side lands (or the agent changes).
  // Local state exists so a drag or a checkbox feels instant; the mutation below
  // is what persists it, and its invalidation re-runs this effect.
  React.useEffect(() => {
    if (all.data && linked.data) setRows(buildRows(all.data, linked.data));
  }, [all.data, linked.data, agent.id]);

  const persist = (next: SkillRowState[]) => {
    setRows(next);
    setSkills.mutate(
      { agentId: agent.id, skills: toPayload(next) },
      { onError: () => toast.error(t("skills.saveError")) },
    );
  };

  const visible = filterRows(rows, query);
  // Reordering while a filter hides rows would silently move a row past hidden
  // neighbours, so ordering is only offered on the unfiltered list.
  const reorderable = query.trim().length === 0;

  const onDrop = (to: number) => {
    if (dragIndex !== null && dragIndex !== to) persist(moveRow(rows, dragIndex, to));
    setDragIndex(null);
    setDragOver(null);
  };

  if (all.isError || linked.isError) {
    return <ErrorState body={t("skills.loadError")} onRetry={() => void all.refetch()} />;
  }
  if (all.isLoading || linked.isLoading) {
    return (
      <div style={s.list}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="Sparkles"
        title={t("skills.emptyTitle")}
        body={t("skills.emptyBody")}
        cta={t("skills.emptyCta")}
        onCta={() => router.push("/skills")}
      />
    );
  }

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.title}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: countActive(rows), total: rows.length })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      <div style={s.list}>
        {visible.map((row) => {
          const index = rows.indexOf(row);
          const struck = row.linked && row.enabled && !row.globallyEnabled;
          return (
            <div
              key={row.id}
              data-testid={`skill-row-${row.name}`}
              draggable={reorderable}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
              onDrop={() => onDrop(index)}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOver(null);
              }}
              style={s.row(row.linked && row.enabled, dragOver === index)}
            >
              {reorderable && (
                <span style={s.handle} aria-hidden>
                  <Icon.Menu size={14} />
                </span>
              )}
              <Checkbox
                checked={row.linked && row.enabled}
                onChange={(v) => persist(toggleRow(rows, row.id, v))}
                label={<span style={s.name(struck)}>{row.name}</span>}
              />
              <span style={{ flex: 1 }} />
              {struck && <span style={s.globalOff}>{t("skills.disabledGlobally")}</span>}
              {row.linked && !row.enabled && (
                <span style={s.globalOff}>{t("skills.attachedOff")}</span>
              )}
              <span className="mono" style={s.typeChip(TYPE_COLORS[row.type])}>
                {t(`skills.type.${row.type}`)}
              </span>
              {reorderable && (
                <span style={s.orderBtns}>
                  <button
                    onClick={() => persist(moveRow(rows, index, index - 1))}
                    disabled={index === 0}
                    aria-label={t("skills.moveUp", { name: row.name })}
                    title={t("skills.moveUp", { name: row.name })}
                    style={s.iconButton(index === 0)}
                  >
                    <Icon.ArrowUp size={13} />
                  </button>
                  <button
                    onClick={() => persist(moveRow(rows, index, index + 1))}
                    disabled={index === rows.length - 1}
                    aria-label={t("skills.moveDown", { name: row.name })}
                    title={t("skills.moveDown", { name: row.name })}
                    style={s.iconButton(index === rows.length - 1)}
                  >
                    <Icon.ArrowDown size={13} />
                  </button>
                </span>
              )}
              {row.linked && (
                <button
                  onClick={() => persist(detachRow(rows, row.id))}
                  aria-label={t("skills.detach", { name: row.name })}
                  title={t("skills.detachHint")}
                  style={s.iconButton(false)}
                >
                  <Icon.X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.footer}>
        <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => router.push("/skills")}>
          {t("skills.manage")}
        </Button>
        <span style={s.savedNote}>
          {setSkills.isPending ? t("skills.saving") : t("skills.autoSaved")}
        </span>
      </div>
    </div>
  );
}
