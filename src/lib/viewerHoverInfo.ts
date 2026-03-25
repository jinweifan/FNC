import type { SegmentRecord } from "./viewerSegments.ts";

type NcWord = {
  letter: string;
  value: string;
};

export type ViewerHoverInfo = {
  isCurve: boolean;
  line: number;
  motionLabel: string;
  start: SegmentRecord["start"];
  end: SegmentRecord["end"];
  angleXY: number;
  length: number;
  chord: number;
  words: NcWord[];
};

function parseWordsFromNcLine(rawLine: string): NcWord[] {
  const clean = rawLine.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").toUpperCase();
  const regex = /([A-Z])([+-]?\d+(?:\.\d+)?)/g;
  const out: NcWord[] = [];
  let match: RegExpExecArray | null = regex.exec(clean);
  while (match) {
    out.push({ letter: match[1], value: match[2] });
    match = regex.exec(clean);
  }
  const order = ["G", "M", "T", "X", "Y", "Z", "U", "V", "W", "R", "I", "J", "K", "F", "S", "P", "Q", "H", "D"];
  return out.sort((a, b) => {
    const ia = order.indexOf(a.letter);
    const ib = order.indexOf(b.letter);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    return ra - rb;
  });
}

export function buildViewerHoverInfo(segment: SegmentRecord | null, rawLine: string): ViewerHoverInfo | null {
  if (!segment) return null;
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dy, dz);
  const isCurve = segment.endFrame.motion === "ArcCw" || segment.endFrame.motion === "ArcCcw";

  return {
    isCurve,
    line: segment.endFrame.lineNumber,
    motionLabel: isCurve
      ? (segment.endFrame.motion === "ArcCw" ? "G02" : "G03")
      : (segment.endFrame.motion === "Rapid" ? "G00" : "G01"),
    start: segment.start,
    end: segment.end,
    angleXY: Math.atan2(dy, dx) * (180 / Math.PI),
    length,
    chord: Math.hypot(dx, dy),
    words: parseWordsFromNcLine(rawLine),
  };
}
