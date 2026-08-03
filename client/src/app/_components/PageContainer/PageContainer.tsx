"use client";

import React from "react";
import { s } from "./styles";

export function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div style={s.container}>
      {(title || actions) && (
        <div style={s.headerRow}>
          <div>
            {title && <h1 style={s.h1}>{title}</h1>}
            {subtitle && <p style={s.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div style={s.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
