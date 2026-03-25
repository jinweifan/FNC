export type ToolbarSpeed = "Low" | "Standard" | "High";
export type ToolbarInteractionMode = "pan" | "rotate";

export type ToolbarPrefs = {
  speed: ToolbarSpeed;
  interactionMode: ToolbarInteractionMode;
  showRapidPath: boolean;
  showGrid: boolean;
  showOrientationGizmo: boolean;
  showPathTooltip: boolean;
};

export function sanitizeToolbarPrefs(value: unknown): ToolbarPrefs | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.speed !== "Low" && candidate.speed !== "Standard" && candidate.speed !== "High")
    || (candidate.interactionMode !== "pan" && candidate.interactionMode !== "rotate")
    || typeof candidate.showRapidPath !== "boolean"
    || typeof candidate.showGrid !== "boolean"
    || typeof candidate.showOrientationGizmo !== "boolean"
    || typeof candidate.showPathTooltip !== "boolean"
  ) {
    return null;
  }
  return {
    speed: candidate.speed,
    interactionMode: candidate.interactionMode,
    showRapidPath: candidate.showRapidPath,
    showGrid: candidate.showGrid,
    showOrientationGizmo: candidate.showOrientationGizmo,
    showPathTooltip: candidate.showPathTooltip,
  };
}
