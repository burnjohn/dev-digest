"use client";

import React from "react";
import { s } from "./styles";

/** Section heading + lede used across the settings sections. */
export function SectionTitle({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h2 style={s.h2}>{title}</h2>
      <p style={s.body}>{body}</p>
    </>
  );
}
