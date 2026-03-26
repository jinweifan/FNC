export type StartupMaskTheme = "light" | "navy" | "dark";

export type StartupMaskConfig = {
  visible: boolean;
  background: string;
  fadeOutMs: number;
};

export function getStartupMaskConfig(theme: StartupMaskTheme): StartupMaskConfig {
  if (theme === "light") {
    return {
      visible: true,
      background: "#eef2f7",
      fadeOutMs: 180,
    };
  }

  if (theme === "navy") {
    return {
      visible: true,
      background: "#020617",
      fadeOutMs: 220,
    };
  }

  return {
    visible: true,
    background: "#000000",
    fadeOutMs: 220,
  };
}
