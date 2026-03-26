export function buildStartupSplashPath(theme: "light" | "navy" | "dark"): string {
  return `startup-splash.html?theme=${encodeURIComponent(theme)}&transparent=1`;
}
