import type { Vec3 } from "../types";

function clampDistance(scale: number, currentDistance: number, minDistance: number, maxDistance: number): number {
  const nextDistance = currentDistance * scale;
  return Math.min(maxDistance, Math.max(minDistance, nextDistance));
}

export function computeAnchoredZoomState(
  position: Vec3,
  target: Vec3,
  anchor: Vec3,
  scale: number,
  minDistance: number,
  maxDistance: number,
): { position: Vec3; target: Vec3 } {
  const offsetX = position.x - target.x;
  const offsetY = position.y - target.y;
  const offsetZ = position.z - target.z;
  const currentDistance = Math.hypot(offsetX, offsetY, offsetZ);
  if (currentDistance < 1e-8) {
    return { position, target };
  }

  const clampedDistance = clampDistance(scale, currentDistance, minDistance, maxDistance);
  const appliedScale = clampedDistance / currentDistance;

  return {
    position: {
      x: anchor.x + (position.x - anchor.x) * appliedScale,
      y: anchor.y + (position.y - anchor.y) * appliedScale,
      z: anchor.z + (position.z - anchor.z) * appliedScale,
    },
    target: {
      x: anchor.x + (target.x - anchor.x) * appliedScale,
      y: anchor.y + (target.y - anchor.y) * appliedScale,
      z: anchor.z + (target.z - anchor.z) * appliedScale,
    },
  };
}
