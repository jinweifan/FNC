import type { SegmentRecord } from "./viewerSegments";

export function buildLinePointBuffer(segments: SegmentRecord[], maxCount?: number): number[] {
  if (!segments.length) return [];

  let source = segments;
  if (maxCount && segments.length > maxCount) {
    const stride = Math.ceil(segments.length / maxCount);
    const sampled: SegmentRecord[] = [];
    for (let i = 0; i < segments.length; i += stride) sampled.push(segments[i]);
    const last = segments[segments.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    source = sampled;
  }

  const out = new Array<number>(source.length * 6);
  let offset = 0;
  for (const segment of source) {
    out[offset++] = segment.start.x;
    out[offset++] = segment.start.y;
    out[offset++] = segment.start.z;
    out[offset++] = segment.end.x;
    out[offset++] = segment.end.y;
    out[offset++] = segment.end.z;
  }
  return out;
}

export function asDreiLinePoints(points: number[]): readonly number[] {
  return points;
}
