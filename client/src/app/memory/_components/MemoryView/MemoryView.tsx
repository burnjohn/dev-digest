/* Memory Browser (A1, L02). Filters (scope/kind/q/freshness) + list + detail.
   Filters are deep-linked: /memory?scope=&kind=&q=&freshness=. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Badge, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { MemoryKind, MemoryScope } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useMemory } from "../../../../lib/hooks/memory";
import { MemoryCard } from "../MemoryCard";
import { MemoryDetail } from "../MemoryDetail";
import { SCOPES, KINDS } from "./constants";
import { parseCsv, toggleValue } from "./helpers";
import { FilterGroup } from "./_components/FilterGroup";
import { CheckRow } from "./_components/CheckRow";
import { s } from "./styles";

export function MemoryView() {
  const t = useTranslations("memory");
  const router = useRouter();
  const params = useSearchParams();

  const scope = parseCsv<MemoryScope>(params.get("scope"), SCOPES);
  const kind = parseCsv<MemoryKind>(params.get("kind"), KINDS);
  const q = params.get("q") ?? "";
  const freshness = (params.get("freshness") as "fresh" | null) ?? null;
  const [selId, setSelId] = React.useState<string | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(q);

  const { data, isLoading, isError, refetch } = useMemory({
    scope: scope.length ? scope : undefined,
    kind: kind.length ? kind : undefined,
    q: q || undefined,
    freshness: freshness ?? "all",
  });

  const items = data ?? [];
  const selected = items.find((m) => m.id === selId) ?? items[0] ?? null;

  const setQuery = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val === null || val === "") p.delete(key);
      else p.set(key, val);
    }
    router.replace(`/memory${p.toString() ? `?${p}` : ""}`);
  };

  const toggleIn = (key: "scope" | "kind", val: string, current: string[]) => {
    const next = toggleValue(current, val);
    setQuery({ [key]: next.length ? next.join(",") : null });
  };

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.layout}>
        {/* filters */}
        <div style={s.filters}>
          <FilterGroup label={t("page.filters.scope")}>
            {SCOPES.map((sc) => (
              <CheckRow
                key={sc}
                label={t(`scope.${sc}`)}
                count={items.filter((m) => m.scope === sc).length}
                on={scope.length === 0 || scope.includes(sc)}
                onClick={() => toggleIn("scope", sc, scope)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label={t("page.filters.kind")}>
            {KINDS.map((k) => (
              <CheckRow
                key={k}
                label={t(`kind.${k}`)}
                count={items.filter((m) => m.kind === k).length}
                on={kind.length === 0 || kind.includes(k)}
                onClick={() => toggleIn("kind", k, kind)}
              />
            ))}
          </FilterGroup>
          <FilterGroup label={t("page.filters.freshness")}>
            <CheckRow
              label={t("page.filters.showStale")}
              on={freshness !== "fresh"}
              onClick={() => setQuery({ freshness: freshness === "fresh" ? null : "fresh" })}
            />
          </FilterGroup>
        </div>

        {/* list */}
        <div style={s.listCol}>
          <div style={s.listHeader}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <span style={s.count}>{t("page.count", { count: items.length })}</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuery({ q: searchDraft || null });
              }}
              style={s.searchForm}
            >
              <Icon.Search size={15} style={s.searchIcon} />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
              <Badge color="var(--text-muted)">{t("page.filterBadge")}</Badge>
            </form>
          </div>
          <div style={s.list}>
            {isLoading && (
              <>
                <Skeleton height={96} />
                <Skeleton height={96} />
                <Skeleton height={96} />
              </>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && items.length === 0 && (
              <EmptyState icon="Database" title={t("page.empty.title")} body={t("page.empty.body")} />
            )}
            {items.map((m) => (
              <MemoryCard key={m.id} m={m} active={selected?.id === m.id} onClick={() => setSelId(m.id)} />
            ))}
          </div>
        </div>

        {/* detail */}
        {selected && <MemoryDetail m={selected} onClosed={() => setSelId(null)} />}
      </div>
    </AppShell>
  );
}
