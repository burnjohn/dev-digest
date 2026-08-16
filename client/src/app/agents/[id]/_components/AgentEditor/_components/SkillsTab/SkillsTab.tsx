/* SkillsTab — link, unlink and reorder the skills attached to one agent.

   Link order is prompt order (the server reads agent_skills.order ASC and
   assemblePrompt joins in that order), so dragging a row is a real semantic
   control, not cosmetics.

   There is no Save button: every toggle and every reorder posts the whole
   ordered set immediately (POST /agents/:id/skills is a replace, so each write
   is idempotent). The local draft exists only to keep the row order stable
   while the request is in flight.

   Rows do NOT re-sort on check/uncheck. The server only stores an order for
   LINKED skills, so "linked first, rest alphabetical" is a seed for the first
   paint; from the first edit onward the display order is held in `order` and an
   unchecked skill keeps its row instead of falling to the bottom. Prompt order
   is then just that display order filtered down to the checked rows. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
} from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "../../../../../../../lib/hooks/skills";
import { TYPE_COLOR } from "../../../../../../skills/_components/SkillCard/constants";
import { filterByName, orderForDisplay, reconcileOrder, reorderLinked } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tSkills = useTranslations("skills");
  const router = useRouter();

  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkills(agent.id);
  const save = useSetAgentSkills(agent.id);

  // Local draft of the ordered link set. Seeded from the server once the links
  // land, then held only until the write it belongs to lands.
  const [draft, setDraft] = React.useState<string[] | null>(null);
  // Remembered ROW order (linked and unlinked alike). `null` until the first
  // edit, which is when the seed ordering stops being re-derived and rows stop
  // moving under the user. Client-only: the server has no order for unlinked
  // skills to persist.
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [filter, setFilter] = React.useState("");
  // Drag state lives in React, NOT in dataTransfer: jsdom has no DataTransfer,
  // and we never drag across documents anyway. The dragged id is mirrored into a
  // ref because dragover/drop READ it — a handler closure captured before the
  // dragstart re-render flushed would otherwise see null and drop the reorder.
  const dragRef = React.useRef<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const serverIds = React.useMemo(() => (links ?? []).map((l) => l.skill_id), [links]);
  const linkedIds = draft ?? serverIds;

  // Drop skills that vanished (deleted elsewhere) so a stale draft can't post a
  // dead id and get a 422.
  const all = skills ?? [];
  const known = React.useMemo(() => new Set(all.map((sk) => sk.id)), [all]);
  const linkedSet = React.useMemo(
    () => new Set(linkedIds.filter((id) => known.has(id))),
    [linkedIds, known],
  );

  // Row order: the remembered one once the user has edited, else the seed.
  const displayIds = React.useMemo(() => {
    const seed = orderForDisplay(all, linkedIds).map((sk) => sk.id);
    return order ? reconcileOrder(order, seed) : seed;
  }, [all, linkedIds, order]);

  const byId = React.useMemo(() => new Map(all.map((sk) => [sk.id, sk])), [all]);
  const ordered = React.useMemo(
    () => displayIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    [displayIds, byId],
  );
  const visible = filterByName(ordered, filter);

  // Prompt order = row order, checked rows only. Deriving it (rather than
  // tracking a separate list) is what makes an unchecked row's position
  // meaningful when it gets re-checked.
  const effectiveIds = React.useMemo(
    () => displayIds.filter((id) => linkedSet.has(id)),
    [displayIds, linkedSet],
  );

  /**
   * Persist a new ordered set, with the row order it was computed against. The
   * draft is shown immediately and only released back to server truth once THIS
   * write lands — a later toggle that overtook it keeps its own draft, so the
   * list never flickers back mid-edit.
   */
  const commit = (nextOrder: string[], nextLinked: string[]) => {
    const prevOrder = order;
    const prevLinked = effectiveIds;
    setOrder(nextOrder);
    setDraft(nextLinked);
    save.mutate(nextLinked, {
      onSuccess: () => setDraft((cur) => (cur === nextLinked ? null : cur)),
      // The global MutationCache.onError already toasts the failure; all this
      // has to do is not leave the UI claiming a link that was never written.
      onError: () => {
        setDraft((cur) => (cur === nextLinked ? prevLinked : cur));
        setOrder((cur) => (cur === nextOrder ? prevOrder : cur));
      },
    });
  };

  const toggle = (id: string) => {
    const next = new Set(linkedSet);
    if (!next.delete(id)) next.add(id);
    // Same row order, different membership — the row stays exactly where it is.
    commit(displayIds, displayIds.filter((x) => next.has(x)));
  };

  /** Drop `fromId` onto `toId`'s prompt slot; unlinked rows stay put. */
  const reorder = (fromId: string, toId: string) => {
    const nextOrder = reorderLinked(displayIds, linkedSet, fromId, toId);
    if (nextOrder === displayIds) return;
    commit(nextOrder, nextOrder.filter((x) => linkedSet.has(x)));
  };

  /**
   * Move a linked skill one prompt slot up or down. Keyboard equivalent of a
   * drag, so it steps over unlinked rows rather than swapping with them.
   */
  const shift = (id: string, delta: -1 | 1) => {
    const at = effectiveIds.indexOf(id);
    if (at === -1) return;
    const target = effectiveIds[at + delta];
    if (target) reorder(id, target);
  };

  const beginDrag = (id: string) => {
    dragRef.current = id;
    setDragId(id);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  const onDrop = (targetId: string) => {
    const dragged = dragRef.current;
    endDrag();
    if (dragged) reorder(dragged, targetId);
  };

  if (isLoading || linksLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("skills.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="Sparkles"
          title={t("skills.emptyTitle")}
          body={t("skills.emptyBody")}
          cta={t("skills.emptyCta")}
          onCta={() => router.push("/skills")}
        />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: effectiveIds.length, total: all.length })}
        </Badge>
        {/* Auto-save has no button to hang "Saving…" off, so the status lives
            here — otherwise a write is completely silent until it fails. */}
        {(save.isPending || save.isSuccess) && (
          <span role="status" style={s.status}>
            {save.isPending ? t("skills.saving") : t("skills.savedNote")}
          </span>
        )}
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>

      {visible.length === 0 && <p style={s.noMatch}>{t("skills.noMatch")}</p>}

      <ul style={s.list}>
        {visible.map((skill) => {
          const position = effectiveIds.indexOf(skill.id);
          const isLinked = position !== -1;
          return (
            <li
              key={skill.id}
              draggable={isLinked}
              onDragStart={() => isLinked && beginDrag(skill.id)}
              onDragOver={(e) => {
                if (!dragRef.current || !isLinked) return;
                e.preventDefault(); // without this the browser refuses the drop
                if (skill.id !== overId) setOverId(skill.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(skill.id);
              }}
              onDragEnd={endDrag}
              style={s.row(isLinked, dragId === skill.id, overId === skill.id && dragId !== skill.id)}
            >
              {/* Drag affordance AND the keyboard path: pointer users drag the
                  row, keyboard users focus the handle and press ↑/↓. */}
              <button
                type="button"
                disabled={!isLinked}
                aria-label={
                  isLinked
                    ? t("skills.reorder", {
                        name: skill.name,
                        position: position + 1,
                        total: effectiveIds.length,
                      })
                    : t("skills.reorderUnlinked", { name: skill.name })
                }
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    shift(skill.id, -1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    shift(skill.id, 1);
                  }
                }}
                style={s.handle(isLinked)}
              >
                <Icon.Menu size={14} />
              </button>
              <Checkbox
                checked={isLinked}
                onChange={() => toggle(skill.id)}
                ariaLabel={skill.name}
                label={
                  <span className="mono" style={s.name}>
                    {skill.name}
                  </span>
                }
              />
              {/* A linked-but-globally-disabled skill is silently skipped at
                  review time. Saying so here is the only place the user finds
                  out before reading the run log. */}
              {!skill.enabled && (
                <span title={t("skills.globallyDisabledTitle")} style={s.disabled}>
                  {t("skills.globallyDisabled")}
                </span>
              )}
              <span style={s.spacer} />
              <Badge color={TYPE_COLOR[skill.type]}>
                {tSkills(`listItem.type.${skill.type}`)}
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
