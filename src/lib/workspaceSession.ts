import type { CameraState } from "../types";

export type StoredWorkspaceSession = {
  filePath: string;
  frameIndex: number;
  lineNumber: number;
  playProgress: number;
  cameraState: CameraState | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeVec3(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.z)) return null;
  return {
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  };
}

function sanitizeCameraState(value: unknown): CameraState | null {
  if (value == null) return null;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const target = sanitizeVec3(candidate.target);
  const position = sanitizeVec3(candidate.position);
  if (!target || !position || !isFiniteNumber(candidate.zoom) || typeof candidate.viewName !== "string") return null;
  return {
    target,
    position,
    zoom: candidate.zoom,
    viewName: candidate.viewName,
  };
}

export function sanitizeStoredWorkspaceSession(value: unknown): StoredWorkspaceSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.filePath !== "string"
    || !candidate.filePath
    || !isFiniteNumber(candidate.frameIndex)
    || !isFiniteNumber(candidate.lineNumber)
    || !isFiniteNumber(candidate.playProgress)
  ) {
    return null;
  }
  if (candidate.frameIndex < 0 || candidate.lineNumber < 1 || candidate.playProgress < 0) return null;
  return {
    filePath: candidate.filePath,
    frameIndex: Math.round(candidate.frameIndex),
    lineNumber: Math.round(candidate.lineNumber),
    playProgress: candidate.playProgress,
    cameraState: sanitizeCameraState(candidate.cameraState),
  };
}

export function resolveRestoredFrameIndex(
  frameCount: number,
  snapshot: Pick<StoredWorkspaceSession, "frameIndex" | "playProgress">,
): number {
  if (frameCount <= 0) return 0;
  if (Number.isFinite(snapshot.frameIndex) && snapshot.frameIndex >= 0) {
    return Math.max(0, Math.min(frameCount - 1, Math.round(snapshot.frameIndex)));
  }
  if (Number.isFinite(snapshot.playProgress)) {
    return Math.max(0, Math.min(frameCount - 1, Math.round(snapshot.playProgress)));
  }
  return 0;
}
