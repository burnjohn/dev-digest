import type { ImportTab } from "../ImportDrawer/constants";

export type { ImportTab };

/** Add-skill dropdown menu items (labels resolved via i18n at render). */
export const ADD_MENU: readonly { tab: ImportTab; labelKey: string; icon: "Upload" | "Link" | "Globe" }[] = [
  { tab: "file", labelKey: "page.menu.fromFile", icon: "Upload" },
  { tab: "url", labelKey: "page.menu.fromUrl", icon: "Link" },
  { tab: "community", labelKey: "page.menu.community", icon: "Globe" },
];

/** Left rail / dropdown widths (px). */
export const SIDEBAR_WIDTH = 290;
export const ADD_MENU_WIDTH = 230;
