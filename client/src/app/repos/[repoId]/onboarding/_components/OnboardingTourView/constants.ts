import type { Icon } from "@devdigest/ui";

/** Map an onboarding section kind to its header icon. */
export const SECTION_ICON: Record<string, keyof typeof Icon> = {
  overview: "Boxes",
  architecture: "Layers",
  modules: "Code",
  "getting-started": "Command",
  conventions: "ListChecks",
};

/** Fallback icon for unknown section kinds. */
export const DEFAULT_SECTION_ICON: keyof typeof Icon = "FileText";
