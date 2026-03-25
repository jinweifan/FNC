export type PaneWidthInput = {
  pane: "files" | "editor";
  immersive: boolean;
  viewportWidth: number;
  requested: number;
};

export type PaneWidthBounds = {
  min: number;
  max: number;
};

function resolveImmersiveMin(pane: "files" | "editor", viewportWidth: number): number {
  if (pane === "files") {
    if (viewportWidth < 900) return 220;
    if (viewportWidth < 1180) return 240;
    return 280;
  }
  if (viewportWidth < 900) return 280;
  if (viewportWidth < 1180) return 320;
  return 360;
}

function resolveImmersiveMax(pane: "files" | "editor", viewportWidth: number, min: number): number {
  const paneCap = pane === "files" ? 520 : 680;
  const chromeMin = viewportWidth < 1180 ? 420 : 560;
  const leftAndRightSafe = 178;
  const viewerMin = viewportWidth < 1180 ? 280 : 360;
  const shareCap = Math.floor(viewportWidth * (viewportWidth < 1180 ? 0.36 : 0.4));
  const max = Math.min(
    paneCap,
    shareCap,
    viewportWidth - chromeMin - leftAndRightSafe,
    viewportWidth - viewerMin - 32,
  );
  return Math.max(min, max);
}

function resolveNormalBounds(pane: "files" | "editor", viewportWidth: number): PaneWidthBounds {
  if (pane === "files") {
    const min = 160;
    const max = Math.max(min, Math.min(600, viewportWidth - 280));
    return { min, max };
  }
  const min = viewportWidth < 1120 ? 280 : 320;
  const max = Math.max(min, Math.min(1400, viewportWidth - 220));
  return { min, max };
}

export function getPaneWidthBounds(input: Omit<PaneWidthInput, "requested">): PaneWidthBounds {
  if (!input.immersive) return resolveNormalBounds(input.pane, input.viewportWidth);
  const min = resolveImmersiveMin(input.pane, input.viewportWidth);
  const max = resolveImmersiveMax(input.pane, input.viewportWidth, min);
  return { min, max };
}

export function clampPaneWidth(input: PaneWidthInput): number {
  const bounds = getPaneWidthBounds(input);
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, input.requested)));
}
