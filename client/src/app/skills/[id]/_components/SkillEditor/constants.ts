export const TABS = ["config", "preview", "stats", "versions"] as const;
export type SkillEditorTab = (typeof TABS)[number];
