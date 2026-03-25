import type { FrameState } from "../types";
import type { SegmentRecord } from "./viewerSegments.ts";

export type ViewerTransientResetResult = {
  clearHoverFrame: boolean;
  clearHoverTooltip: boolean;
  clearPickedSegment: boolean;
};

export function getViewerSourceSignature(frames: FrameState[]): string {
  if (!frames.length) return "empty";
  const first = frames[0];
  const last = frames[frames.length - 1];
  return [
    frames.length,
    first.index,
    first.lineNumber,
    first.position.x,
    first.position.y,
    first.position.z,
    last.index,
    last.lineNumber,
    last.position.x,
    last.position.y,
    last.position.z,
  ].join("|");
}

export function isSegmentRecordStale(segment: SegmentRecord | null, frames: FrameState[]): boolean {
  if (!segment) return false;
  const idx = segment.endFrame.index;
  if (!Number.isFinite(idx) || idx < 0 || idx >= frames.length) return true;
  const frame = frames[idx];
  return (
    frame.lineNumber !== segment.endFrame.lineNumber
    || frame.position.x !== segment.endFrame.position.x
    || frame.position.y !== segment.endFrame.position.y
    || frame.position.z !== segment.endFrame.position.z
  );
}

export function shouldClearTransientViewerState(args: {
  previousIsPlaying: boolean;
  nextIsPlaying: boolean;
  sourceChanged: boolean;
}): ViewerTransientResetResult {
  const stoppedPlayback = args.previousIsPlaying && !args.nextIsPlaying;
  const shouldClear = args.sourceChanged || stoppedPlayback;
  return {
    clearHoverFrame: shouldClear,
    clearHoverTooltip: shouldClear,
    clearPickedSegment: shouldClear,
  };
}
