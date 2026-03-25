import type { FrameState, Vec3 } from "../types";
import { buildLinePointBuffer } from "./viewerLinePoints.ts";
import { buildViewerSegmentData, type SegmentRecord, type ViewerSegmentData } from "./viewerSegments.ts";

export type ViewerSceneData = {
  segmentData: ViewerSegmentData;
  centerFrames: FrameState[];
  sceneScale: number;
  geometryCenter: Vec3;
};

export type ViewerPickCollections = {
  pickCutSegments: SegmentRecord[];
  pickRapidSegments: SegmentRecord[];
  sampledSegments: SegmentRecord[];
  fullSegments: SegmentRecord[];
};

export type ViewerRenderBuffers = {
  cutPoints: number[];
  uvwPoints: number[];
  plungePoints: number[];
  rapidPoints: number[];
};

function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v);
}

function framesForCenter(frames: FrameState[]): FrameState[] {
  if (frames.length < 2) return frames;
  const firstCut = frames.findIndex((f, i) => i > 0 && f.motion && f.motion !== "Rapid");
  let base = firstCut > 0 ? frames.slice(Math.max(0, firstCut - 1)) : frames;
  if (base.length < 2) base = frames;

  const p0 = base[0]?.position;
  if (p0) {
    const nearOrigin = Math.hypot(p0.x, p0.y, p0.z) < 1e-6;
    if (nearOrigin && base.length > 2) {
      const withoutFirst = base.slice(1);
      const hasFarPoint = withoutFirst.some((f) => Math.hypot(f.position.x, f.position.y, f.position.z) > 1);
      if (hasFarPoint) base = withoutFirst;
    }
  }
  return base;
}

export function sampleViewerSegments(segments: SegmentRecord[], maxCount: number): SegmentRecord[] {
  if (segments.length <= maxCount) return segments;
  const stride = Math.ceil(segments.length / maxCount);
  const out: SegmentRecord[] = [];
  for (let i = 0; i < segments.length; i += stride) out.push(segments[i]);
  const last = segments[segments.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function buildViewerSceneData(frames: FrameState[], codeLines: string[]): ViewerSceneData {
  const segmentData = buildViewerSegmentData(frames, codeLines);
  const centerFrames = framesForCenter(frames);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const f of centerFrames) {
    const { x, y, z } = f.position;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (
    !isFiniteNumber(minX) || !isFiniteNumber(minY) || !isFiniteNumber(minZ)
    || !isFiniteNumber(maxX) || !isFiniteNumber(maxY) || !isFiniteNumber(maxZ)
  ) {
    return {
      segmentData,
      centerFrames,
      sceneScale: 100,
      geometryCenter: { x: 0, y: 0, z: 0 },
    };
  }

  return {
    segmentData,
    centerFrames,
    sceneScale: Math.max(80, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)),
    geometryCenter: {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      z: (minZ + maxZ) * 0.5,
    },
  };
}

export function buildViewerPickCollections(
  segmentData: ViewerSegmentData,
  showRapidPath: boolean,
  scaledCount: (base: number, floor?: number) => number,
): ViewerPickCollections {
  const pickCutSegments = sampleViewerSegments(segmentData.cutSegments, scaledCount(9000, 1800));
  const pickRapidSegments = sampleViewerSegments(segmentData.rapidSegments, scaledCount(4500, 900));
  return {
    pickCutSegments,
    pickRapidSegments,
    sampledSegments: showRapidPath ? [...pickCutSegments, ...pickRapidSegments] : pickCutSegments,
    fullSegments: showRapidPath ? [...segmentData.cutSegments, ...segmentData.rapidSegments] : segmentData.cutSegments,
  };
}

export function buildViewerRenderBuffers(
  segmentData: ViewerSegmentData,
  isPointerDown: boolean,
  scaledCount: (base: number, floor?: number) => number,
): ViewerRenderBuffers {
  return {
    cutPoints: buildLinePointBuffer(
      segmentData.cutRenderSegments,
      isPointerDown ? scaledCount(9000, 1800) : scaledCount(28000, 3200),
    ),
    plungePoints: buildLinePointBuffer(segmentData.plungeRenderSegments),
    uvwPoints: buildLinePointBuffer(
      segmentData.uvwRenderSegments,
      isPointerDown ? scaledCount(7000, 1400) : scaledCount(22000, 2800),
    ),
    rapidPoints: buildLinePointBuffer(
      segmentData.rapidRenderSegments,
      isPointerDown ? scaledCount(6000, 1000) : scaledCount(18000, 2400),
    ),
  };
}
