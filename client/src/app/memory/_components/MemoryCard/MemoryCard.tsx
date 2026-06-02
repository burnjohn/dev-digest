"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, ConfidenceNum } from "@devdigest/ui";
import type { MemoryDto } from "../../../../lib/hooks/memory";
import { MEM_KIND, MEM_SCOPE } from "./constants";
import { lastUsedKey } from "./helpers";
import { s } from "./styles";

export function MemoryCard({
  m,
  active,
  onClick,
}: {
  m: MemoryDto;
  active: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("memory");
  const k = MEM_KIND[m.kind];
  const KIcon = Icon[k.icon];
  const used = lastUsedKey(m.last_used_at);
  return (
    <div onClick={onClick} style={s.card(active)}>
      <div style={s.header}>
        <span style={s.kindChip(k.c)}>
          <KIcon size={11} />
          {t(`kind.${m.kind}`)}
        </span>
        <Badge color={MEM_SCOPE[m.scope]} bg="transparent" style={s.scopeBadgeBorder(MEM_SCOPE[m.scope])}>
          {t(`scope.${m.scope}`)}
        </Badge>
        <span style={s.confidence}>
          <ConfidenceNum value={m.confidence} />
        </span>
      </div>
      <div style={s.content}>{m.content}</div>
      <div style={s.footer}>
        {m.sources
          .filter((src) => src.pr != null)
          .map((src, i) => (
            <span key={i} className="mono" style={s.prTag}>
              #{src.pr}
            </span>
          ))}
        <span style={s.usedAt}>{t(used.key, used.values)}</span>
      </div>
    </div>
  );
}
