"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, TextInput, Badge, Chip, Icon, Skeleton, EmptyState } from "@devdigest/ui";
import type { CommunitySkill } from "@devdigest/shared";
import { useImportSkill, useCommunitySkills } from "../../../../../../lib/hooks/skills";
import { communityLangs, filterByLang } from "../../helpers";
import { COMMUNITY_CLOSE_DELAY_MS } from "../../constants";
import { s } from "../../styles";

export function CommunityPanel({ onDone }: { onDone: () => void }) {
  const t = useTranslations("skills");
  const [q, setQ] = React.useState("");
  const [lang, setLang] = React.useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useCommunitySkills(q);
  const imp = useImportSkill();
  const [importing, setImporting] = React.useState<string | null>(null);

  const all = data ?? [];
  const filtered = filterByLang(all, lang);
  const langs = communityLangs(all);

  const importOne = async (c: CommunitySkill) => {
    setImporting(c.name);
    try {
      // community skills import disabled + flagged for vetting (§11)
      await imp.mutateAsync({
        body: `# ${c.name}\n\n${c.desc}\n\nSource: ${c.repo}`,
        name: c.name,
        source: "community",
      });
      setTimeout(onDone, COMMUNITY_CLOSE_DELAY_MS);
    } finally {
      setImporting(null);
    }
  };

  return (
    <>
      <TextInput
        value={q}
        onChange={setQ}
        placeholder={t("community.searchPlaceholder")}
        suffix={<Icon.Search size={14} style={s.searchIcon} />}
      />
      <div style={s.langChips}>
        <Chip active={lang === null} onClick={() => setLang(null)}>
          {t("community.allLanguages")}
        </Chip>
        {langs.map((l) => (
          <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
            {l}
          </Chip>
        ))}
      </div>
      {isLoading && (
        <div style={s.loadingStack}>
          <Skeleton height={86} />
          <Skeleton height={86} />
        </div>
      )}
      {isError && (
        <EmptyState icon="Globe" title={t("community.loadError")} cta={t("community.retry")} onCta={() => refetch()} />
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState icon="Search" title={t("community.noMatch.title")} body={t("community.noMatch.body")} />
      )}
      <div style={s.cardList}>
        {filtered.map((c) => (
          <div key={c.name} style={s.card}>
            <div style={s.cardHeader}>
              <span className="mono" style={s.cardName}>
                {c.name}
              </span>
              <span className="tnum" style={s.stars}>
                <Icon.Star size={12} />
                {c.stars.toLocaleString()}
              </span>
            </div>
            <div style={s.cardDesc}>{c.desc}</div>
            <div style={s.cardFooter}>
              <span className="mono" style={s.repo}>
                {c.repo}
              </span>
              <Badge color="var(--text-muted)">{c.lang}</Badge>
              <div style={s.cardAction}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Plus"
                  onClick={() => importOne(c)}
                  disabled={importing === c.name}
                >
                  {importing === c.name ? t("community.importing") : t("community.import")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
