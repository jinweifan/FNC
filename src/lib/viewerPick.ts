import { pointToSegmentDistanceSq2D } from "./viewerPickGeometry.ts";
import type { SegmentRecord } from "./viewerSegments";

type ProjectedSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

export function findClosestScreenSpaceSegment<T extends SegmentRecord>(
  segments: readonly T[],
  mx: number,
  my: number,
  thresholdSq: number,
  project: (segment: T) => ProjectedSegment,
): T | null {
  let best: T | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const { ax, ay, bx, by } = project(segment);
    const d2 = pointToSegmentDistanceSq2D(mx, my, ax, ay, bx, by);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = segment;
    }
  }

  if (!best || bestD2 > thresholdSq) return null;
  return best;
}
