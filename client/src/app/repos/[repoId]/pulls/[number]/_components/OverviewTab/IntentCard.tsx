"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { Icon } from "@devdigest/ui";
import { useIntent, useRecomputeIntent } from "@/lib/hooks/intent";

interface IntentCardProps {
  prId: string | number;
}

export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);

  const recomputeButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={recompute.isPending}
      aria-label={t("intent.recomputeAriaLabel")}
      onClick={() => recompute.mutate()}
    >
      {t("intent.recompute")}
    </Button>
  );

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="Target" right={recomputeButton}>
        {t("intent.sectionLabel")}
      </SectionLabel>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="80%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={14} width="70%" />
        </div>
      )}

      {isError && !isLoading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("intent.error")}
        </p>
      )}

      {!isLoading && !isError && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Intent summary as a styled quote */}
          <p
            style={{
              fontSize: 14,
              fontStyle: "italic",
              color: "var(--text-secondary)",
              margin: 0,
              lineHeight: 1.6,
              borderLeft: "3px solid var(--border)",
              paddingLeft: 12,
            }}
          >
            {data.intent}
          </p>

          {/* In-scope list */}
          {data.in_scope.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  margin: "0 0 6px 0",
                }}
              >
                {t("intent.inScopeLabel")}
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {data.in_scope.map((item, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    <Icon.CheckCircle
                      size={14}
                      style={{ color: "var(--ok)", flexShrink: 0, marginTop: 2 }}
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Out-of-scope list */}
          {data.out_of_scope.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  margin: "0 0 6px 0",
                }}
              >
                {t("intent.outOfScopeLabel")}
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {data.out_of_scope.map((item, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    <Icon.XCircle
                      size={14}
                      style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }}
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
