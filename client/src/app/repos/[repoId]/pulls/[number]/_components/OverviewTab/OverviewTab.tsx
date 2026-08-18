"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { usePrIntent, useRefreshIntent } from "../../../../../../../lib/hooks/reviews";
import { IntentPanel } from "../IntentPanel";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  headSha: string;
}

/** Intent is shown first — BEFORE the review findings tab — so a reviewer sees
 *  what the PR claims to do (and its declared scope) before diving into the
 *  code. */
export function OverviewTab({ prId, prBody, headSha }: OverviewTabProps) {
  const { data: intent, isLoading: intentLoading } = usePrIntent(prId);
  const refresh = useRefreshIntent(prId);

  return (
    <>
      <IntentPanel
        intent={intent}
        isLoading={intentLoading}
        headSha={headSha}
        onRefresh={() => refresh.mutate()}
        refreshing={refresh.isPending}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
