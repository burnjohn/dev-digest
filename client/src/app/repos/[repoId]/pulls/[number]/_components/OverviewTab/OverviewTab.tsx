"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { BlastOverviewCard } from "../BlastOverviewCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** Open the dedicated Blast radius tab. */
  onOpenBlast: () => void;
}

export function OverviewTab({ prBody, prId, onOpenBlast }: OverviewTabProps) {
  return (
    <>
      <BlastOverviewCard prId={prId} onOpen={onOpenBlast} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
