import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import { resolveViewerFocusPointBuffer, resolveViewerFocusSegment } from "./viewerFocusSegment.ts";
import type { SegmentRecord } from "./viewerSegments.ts";

function makeFrame(index: number, lineNumber: number, x: number, y = 0, z = 0): FrameState {
  return {
    index,
    lineNumber,
    position: { x, y, z },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

test("resolveViewerFocusSegment prefers the picked segment for the active frame", () => {
  const frames = [makeFrame(0, 1, 0), makeFrame(1, 2, 10), makeFrame(2, 3, 20)];
  const picked: SegmentRecord = {
    start: { x: 3, y: 4, z: 5 },
    end: { x: 6, y: 7, z: 8 },
    endFrame: frames[1],
    sourceIndex: 0,
    lane: "cut",
  };

  assert.deepEqual(resolveViewerFocusSegment(frames, frames[1], picked), [picked.start, picked.end]);
});

test("resolveViewerFocusSegment falls back to the nearest visible segment when target is degenerate", () => {
  const frames = [
    makeFrame(0, 1, 0, 0, 0),
    makeFrame(1, 2, 0, 0, 0),
    makeFrame(2, 3, 5, 0, 0),
    makeFrame(3, 4, 9, 0, 0),
  ];

  assert.deepEqual(resolveViewerFocusSegment(frames, frames[1], null), [
    frames[1].position,
    frames[2].position,
  ]);
});


test("resolveViewerFocusPointBuffer flattens the active segment into the smallest render payload", () => {
  const frames = [makeFrame(0, 1, 0), makeFrame(1, 2, 10), makeFrame(2, 3, 20)];
  const picked: SegmentRecord = {
    start: { x: 1, y: 2, z: 3 },
    end: { x: 4, y: 5, z: 6 },
    endFrame: frames[1],
    sourceIndex: 0,
    lane: "cut",
  };

  assert.deepEqual(resolveViewerFocusPointBuffer(frames, frames[1], picked), [1, 2, 3, 4, 5, 6]);
});
