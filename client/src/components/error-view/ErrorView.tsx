/* Shared full-page failure state, used by the App Router error boundaries
   (`app/error.tsx`) and `app/not-found.tsx`.

   Deliberately NOT `EmptyState` from @devdigest/ui: that primitive hardcodes a
   "Plus" icon on its CTA, which reads as "create something" — wrong for a retry
   or a navigate-home action. The visual language is otherwise the same. */
"use client";

import React from "react";
import { Button, Icon, type IconName } from "@devdigest/ui";
import { s } from "./styles";

export function ErrorView({
  icon = "AlertTriangle",
  title,
  body,
  detail,
  cta,
  onCta,
}: {
  icon?: IconName;
  title: string;
  body?: React.ReactNode;
  /** Technical detail (message / digest). Rendered muted and monospaced. */
  detail?: string | null;
  cta?: string;
  onCta?: () => void;
}) {
  const I = Icon[icon];
  return (
    <div style={s.root} role="alert">
      <div style={s.badge}>
        <I size={22} />
      </div>
      <div style={s.title}>{title}</div>
      {body && <div style={s.body}>{body}</div>}
      {detail && (
        <div style={s.detail} className="mono">
          {detail}
        </div>
      )}
      {cta && onCta && (
        <div style={s.cta}>
          <Button kind="secondary" icon="RefreshCw" onClick={onCta}>
            {cta}
          </Button>
        </div>
      )}
    </div>
  );
}

export default ErrorView;
