import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import type { SegmentRecord } from "./viewerSegments.ts";
import {
  getViewerSourceSignature,
  isSegmentRecordStale,
  shouldClearTransientViewerState,
} from "./viewerPlaybackState.ts";

function makeFrame(index: number, lineNumber: number): FrameState {
  return {
    index,
    lineNumber,
    position: { x: index, y: lineNumber, z: 0 },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

test("isSegmentRecordStale detects segments that no longer match the current frame source", () => {
  const previousFrames = [makeFrame(0, 1), makeFrame(1, 2)];
  const nextFrames = [makeFrame(0, 10), makeFrame(1, 20)];
  const segment: SegmentRecord = {
    start: previousFrames[0].position,
    end: previousFrames[1].position,
    endFrame: previousFrames[1],
    sourceIndex: 0,
    lane: "cut",
  };

  assert.equal(isSegmentRecordStale(segment, nextFrames), true);
  assert.equal(isSegmentRecordStale(segment, previousFrames), false);
});

test("shouldClearTransientViewerState clears only transient overlays when playback stops", () => {
  assert.deepEqual(
    shouldClearTransientViewerState({
      previousIsPlaying: true,
      nextIsPlaying: false,
      sourceChanged: false,
    }),
    {
      clearHoverFrame: true,
      clearHoverTooltip: true,
      clearPickedSegment: true,
    },
  );
});

test("getViewerSourceSignature changes when frame source changes materially", () => {
  const a = [makeFrame(0, 1), makeFrame(1, 2)];
  const b = [makeFrame(0, 1), makeFrame(1, 99)];

  assert.notEqual(getViewerSourceSignature(a), getViewerSourceSignature(b));
});
