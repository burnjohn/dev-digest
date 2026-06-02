import React from "react";
import { toPct } from "../../helpers";
import { s } from "./styles";

/** Inline percentage bar used in the Eval Dashboard recent-runs table. */
export function MiniBar({ value, color }: { value: number | null; color: string }) {
  const v = toPct(value);
  return (
    <div style={s.wrap}>
      <div style={s.track}>
        <div style={s.fill(v, color)} />
      </div>
      <span className="mono tnum" style={s.value}>
        {v}
      </span>
    </div>
  );
}
