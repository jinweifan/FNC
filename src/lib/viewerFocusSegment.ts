import type { FrameState, Vec3 } from "../types";
import type { SegmentRecord } from "./viewerSegments";

export function resolveViewerFocusSegment(
  frames: FrameState[],
  markerFrame: FrameState | null,
  pickedSegment: SegmentRecord | null,
): Vec3[] | null {
  if (!markerFrame || frames.length < 2) return null;
  if (
    pickedSegment &&
    pickedSegment.endFrame.index === markerFrame.index &&
    pickedSegment.endFrame.lineNumber === markerFrame.lineNumber
  ) {
    return [pickedSegment.start, pickedSegment.end];
  }

  const markerIdx = typeof markerFrame.index === "number"
    ? Math.max(0, Math.min(frames.length - 1, markerFrame.index))
    : Math.max(0, frames.findIndex((f) => f.lineNumber === markerFrame.lineNumber));

  const makeSeg = (aIdx: number, bIdx: number) => {
    if (aIdx < 0 || bIdx < 0 || aIdx >= frames.length || bIdx >= frames.length) return null;
    const a = frames[aIdx].position;
    const b = frames[bIdx].position;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 1e-8) return null;
    return [a, b];
  };

  const exact = markerIdx > 0 ? makeSeg(markerIdx - 1, markerIdx) : makeSeg(0, 1);
  if (exact) return exact;

  const line = markerFrame.lineNumber;
  let bestSameLine: Vec3[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].lineNumber !== line) continue;
    const seg = makeSeg(i - 1, i);
    if (!seg) continue;
    const score = Math.abs(i - markerIdx);
    if (score < bestScore) {
      bestScore = score;
      bestSameLine = seg;
    }
  }
  if (bestSameLine) return bestSameLine;

  for (let d = 1; d < Math.min(60, frames.length); d += 1) {
    const left = markerIdx - d;
    const right = markerIdx + d;
    const leftSeg = left > 0 ? makeSeg(left - 1, left) : null;
    if (leftSeg) return leftSeg;
    const rightSeg = right < frames.length ? makeSeg(Math.max(0, right - 1), right) : null;
    if (rightSeg) return rightSeg;
  }

  const fallbackLine = markerFrame.lineNumber;
  const all: Vec3[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].lineNumber !== fallbackLine) continue;
    const seg = makeSeg(i - 1, i);
    if (!seg) continue;
    all.push(seg[0], seg[1]);
  }
  return all.length > 1 ? all : null;
}

export function resolveViewerFocusPointBuffer(
  frames: FrameState[],
  markerFrame: FrameState | null,
  pickedSegment: SegmentRecord | null,
): number[] | null {
  const points = resolveViewerFocusSegment(frames, markerFrame, pickedSegment);
  if (!points || points.length < 2) return null;
  const out = new Array<number>(points.length * 3);
  let offset = 0;
  for (const point of points) {
    out[offset++] = point.x;
    out[offset++] = point.y;
    out[offset++] = point.z;
  }
  return out;
}
