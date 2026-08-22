/* theme.tsx — dark/light theming via data-theme on <html>. */
"use client";

import React from "react";

type Theme = "dark" | "light";
const ThemeCtx = React.createContext<{ theme: Theme; toggle: () => void; set: (t: Theme) => void }>({
  theme: "dark",
  toggle: () => {},
  set: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>("dark");

  // hydrate from the attribute set by the no-FOUC inline script
  React.useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(current);
  }, []);

  const set = React.useCallback((t: Theme) => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("dd-theme", t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = React.useCallback(() => {
    set(theme === "dark" ? "light" : "dark");
  }, [theme, set]);

  return <ThemeCtx.Provider value={{ theme, toggle, set }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeCtx);
}

/** Inline script string injected in <head> to set data-theme before paint. */
export const themeNoFlashScript = `(function(){try{var t=localStorage.getItem('dd-theme')||'dark';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-density','regular');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
