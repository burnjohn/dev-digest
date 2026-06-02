/* nav.ts — sidebar nav groups (§9) + keyboard shortcut registry (§9).
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "onboarding-tour", label: "Onboarding Tour", icon: "Boxes", href: "/repos/:repoId/onboarding", gKey: "o" },
      { key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context", gKey: "x" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
      { key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/eval", gKey: "e" },
    ],
  },
  {
    section: "GLOBAL",
    items: [
      { key: "memory", label: "Memory", icon: "Database", href: "/memory", gKey: "m" },
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" },
      { key: "agent-performance", label: "Agent Performance", icon: "Activity", href: "/agent-performance" },
      { key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "github", label: "GitHub Integration" },
  { key: "workspace", label: "Workspace" },
  { key: "automatic-reviews", label: "Automatic Reviews" },
  { key: "integrations", label: "Integrations" },
  { key: "plugins", label: "Plugins & Digest" },
  { key: "about", label: "About" },
] as const;

/** Keyboard shortcut registry (§9). Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g m", label: "Go to Memory", group: "Navigation" },
  { keys: "g e", label: "Go to Eval Dashboard", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
  { keys: "l", label: "Learn from finding", group: "Findings" },
  { keys: "c", label: "Compose review", group: "Actions" },
  { keys: "w", label: "git-why (why this line)", group: "Actions" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
