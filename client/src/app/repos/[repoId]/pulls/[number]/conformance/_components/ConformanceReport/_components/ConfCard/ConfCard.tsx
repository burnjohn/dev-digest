import React from "react";
import { MonoLink } from "@devdigest/ui";
import { s } from "./styles";

/** A single requirement card within a conformance column. */
export function ConfCard({
  title,
  note,
  ev,
  color,
}: {
  title: string;
  note?: string | null;
  ev?: string | null;
  color: string;
}) {
  return (
    <div style={s.card(color)}>
      <div style={s.title}>{title}</div>
      {note && <div style={s.note}>{note}</div>}
      {ev && (
        <div style={s.evidence}>
          <MonoLink>{ev}</MonoLink>
        </div>
      )}
    </div>
  );
}

export default ConfCard;
