import type { TrifectaComponent } from "@devdigest/shared";

/** Constants for the TrifectaVenn (lethal-trifecta) display. */

/** i18n key suffix per trifecta component (under the `trifecta` namespace). */
export const LABEL_KEYS: Record<TrifectaComponent, string> = {
  private_data_access: "privateData",
  untrusted_input: "untrustedInput",
  exfil_path: "exfilPath",
};

/** Render order of the three components. */
export const KEYS: TrifectaComponent[] = [
  "private_data_access",
  "untrusted_input",
  "exfil_path",
];

/** Circle centre positions in the SVG (one per KEYS entry). */
export const POSITIONS = [
  { cx: 34, cy: 26 },
  { cx: 56, cy: 26 },
  { cx: 45, cy: 44 },
] as const;
