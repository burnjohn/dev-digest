"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
}

export function OverviewTab({ prBody }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}
    </>
  );
}
