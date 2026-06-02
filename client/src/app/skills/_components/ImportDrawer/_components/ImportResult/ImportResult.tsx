"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

/** Inline success/error line shown beneath an import action. */
export function ImportResult({ ok, message }: { ok: boolean; message: string }) {
  return (
    <div style={s.result(ok)}>
      {ok ? <Icon.CheckCircle size={14} /> : <Icon.XCircle size={14} />}
      {message}
    </div>
  );
}
