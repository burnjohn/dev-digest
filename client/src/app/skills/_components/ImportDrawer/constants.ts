/** Constants for the skills ImportDrawer. */

export type ImportTab = "file" | "url" | "community";

/** Tab order for the drawer header (labels resolved via i18n). */
export const IMPORT_TABS: readonly { key: ImportTab; labelKey: string }[] = [
  { key: "file", labelKey: "drawer.tabs.file" },
  { key: "url", labelKey: "drawer.tabs.url" },
  { key: "community", labelKey: "drawer.tabs.community" },
];

/** Drawer width (px). */
export const DRAWER_WIDTH = 480;

/** Delay (ms) before auto-closing the drawer after a successful import. */
export const FILE_CLOSE_DELAY_MS = 700;
export const URL_CLOSE_DELAY_MS = 900;
export const COMMUNITY_CLOSE_DELAY_MS = 700;
