import type { FrameState } from "../types";

type Vec3Like = { x: number; y: number; z: number };

export type SegmentRecord = {
  start: Vec3Like;
  end: Vec3Like;
  endFrame: FrameState;
  sourceIndex: number;
  lane: "cut" | "rapid";
};

export type ViewerSegmentData = {
  cutRenderSegments: SegmentRecord[];
  uvwRenderSegments: SegmentRecord[];
  plungeRenderSegments: SegmentRecord[];
  rapidRenderSegments: SegmentRecord[];
  cutSegments: SegmentRecord[];
  rapidSegments: SegmentRecord[];
};

export function buildViewerSegmentData(frames: FrameState[], codeLines: string[]): ViewerSegmentData {
  const cutRenderSegments: SegmentRecord[] = [];
  const uvwRenderSegments: SegmentRecord[] = [];
  const plungeRenderSegments: SegmentRecord[] = [];
  const rapidRenderSegments: SegmentRecord[] = [];
  const cutSegments: SegmentRecord[] = [];
  const rapidSegments: SegmentRecord[] = [];
  const explicitWByLine = new Map<number, number>();

  for (let i = 0; i < codeLines.length; i += 1) {
    const raw = codeLines[i];
    if (!raw) continue;
    const clean = raw.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").toUpperCase();
    const matches = [...clean.matchAll(/\bW([+-]?\d+(?:\.\d+)?)\b/g)];
    if (!matches.length) continue;
    const last = matches[matches.length - 1];
    const value = Number(last[1]);
    if (Number.isFinite(value)) explicitWByLine.set(i + 1, value);
  }

  const modalWByLine = new Map<number, number>();
  let modalW: number | null = null;
  for (let line = 1; line <= codeLines.length; line += 1) {
    const explicit = explicitWByLine.get(line);
    if (explicit !== undefined) modalW = explicit;
    if (modalW !== null) modalWByLine.set(line, modalW);
  }

  let lastWValue: number | null = null;

  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    const domain = b.axisDomain ?? "xyz";
    const currentW = modalWByLine.get(b.lineNumber);
    const prevW = modalWByLine.get(a.lineNumber) ?? lastWValue;
    const isPlunge = domain === "uvw"
      ? (
        b.position.z > a.position.z + 1e-6 ||
        (currentW !== undefined && prevW !== null && prevW !== undefined && currentW < prevW - 1e-6)
      )
      : b.position.z < a.position.z - 1e-6;

    if (b.motion === "Rapid") {
      const rapidSeg: SegmentRecord = {
        start: a.position,
        end: b.position,
        endFrame: b,
        sourceIndex: rapidSegments.length,
        lane: "rapid",
      };
      rapidSegments.push(rapidSeg);
      rapidRenderSegments.push(rapidSeg);

      if (isPlunge) {
        const plungeSeg: SegmentRecord = {
          start: a.position,
          end: b.position,
          endFrame: b,
          sourceIndex: cutSegments.length,
          lane: "cut",
        };
        cutSegments.push(plungeSeg);
        plungeRenderSegments.push(plungeSeg);
      }
    } else {
      const cutSeg: SegmentRecord = {
        start: a.position,
        end: b.position,
        endFrame: b,
        sourceIndex: cutSegments.length,
        lane: "cut",
      };
      cutSegments.push(cutSeg);

      if (b.axisDomain === "uvw") {
        uvwRenderSegments.push(cutSeg);
        if (isPlunge) plungeRenderSegments.push(cutSeg);
      } else if (isPlunge) {
        plungeRenderSegments.push(cutSeg);
      } else {
        cutRenderSegments.push(cutSeg);
      }
    }

    if (domain === "uvw" && currentW !== undefined) lastWValue = currentW;
  }

  return {
    cutRenderSegments,
    uvwRenderSegments,
    plungeRenderSegments,
    rapidRenderSegments,
    cutSegments,
    rapidSegments,
  };
}
