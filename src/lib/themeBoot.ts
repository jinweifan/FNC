export type ThemeMode = "system" | "light" | "navy" | "xdark";
export type ResolvedTheme = "light" | "navy" | "dark";
export type BootPalette = {
  background: string;
  text: string;
  panel: string;
  border: string;
  muted: string;
};

type ThemeDomTarget = {
  documentElement: {
    style: {
      backgroundColor: string;
      color: string;
      colorScheme?: string;
      setProperty(name: string, value: string): void;
    };
    setAttribute(name: string, value: string): void;
  };
  body?: {
    style: {
      backgroundColor: string;
      color: string;
    };
  } | null;
  getElementById?(id: string): { style: { backgroundColor: string; color: string } } | null;
};

export function resolveBootTheme(themeMode: string | null | undefined, systemDark: boolean): ResolvedTheme {
  if (themeMode === "light") return "light";
  if (themeMode === "navy") return "navy";
  if (themeMode === "xdark") return "dark";
  return systemDark ? "dark" : "light";
}

export function getBootThemePalette(theme: ResolvedTheme): BootPalette {
  if (theme === "navy") {
    return {
      background: "#020617",
      text: "#dbeafe",
      panel: "#0f172a",
      border: "#334155",
      muted: "#94a3b8",
    };
  }
  if (theme === "dark") {
    return {
      background: "#000000",
      text: "#e7e9ea",
      panel: "#16181c",
      border: "#2f3336",
      muted: "#71767b",
    };
  }
  return {
    background: "#eef2f7",
    text: "#0f172a",
    panel: "#ffffff",
    border: "#d1dbe8",
    muted: "#64748b",
  };
}

export function applyThemePaletteToDom(
  doc: ThemeDomTarget,
  theme: ResolvedTheme,
  palette: BootPalette,
): void {
  doc.documentElement.setAttribute("data-theme", theme);
  doc.documentElement.style.backgroundColor = palette.background;
  doc.documentElement.style.color = palette.text;
  doc.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  doc.documentElement.style.setProperty("--boot-bg", palette.background);
  doc.documentElement.style.setProperty("--boot-text", palette.text);
  doc.documentElement.style.setProperty("--boot-panel", palette.panel);
  doc.documentElement.style.setProperty("--boot-border", palette.border);
  doc.documentElement.style.setProperty("--boot-muted", palette.muted);

  if (doc.body) {
    doc.body.style.backgroundColor = palette.background;
    doc.body.style.color = palette.text;
  }

  const root = doc.getElementById?.("root");
  if (root) {
    root.style.backgroundColor = palette.background;
    root.style.color = palette.text;
  }
}
