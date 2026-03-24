import test from "node:test";
import assert from "node:assert/strict";
import { findClosestScreenSpaceSegment } from "./viewerPick.ts";
import type { SegmentRecord } from "./viewerSegments.ts";
import type { FrameState } from "../types";

function makeFrame(index: number): FrameState {
  return {
    index,
    lineNumber: index + 1,
    position: { x: index, y: 0, z: 0 },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

function makeSegment(
  sourceIndex: number,
  start: [number, number],
  end: [number, number],
): SegmentRecord {
  return {
    start: { x: start[0], y: start[1], z: 0 },
    end: { x: end[0], y: end[1], z: 0 },
    endFrame: makeFrame(sourceIndex),
    sourceIndex,
    lane: "cut",
  };
}

test("findClosestScreenSpaceSegment returns nearest segment within threshold", () => {
  const near = makeSegment(0, [0, 0], [10, 0]);
  const far = makeSegment(1, [30, 0], [40, 0]);

  const hit = findClosestScreenSpaceSegment(
    [far, near],
    6,
    2,
    100,
    (segment) => ({
      ax: segment.start.x,
      ay: segment.start.y,
      bx: segment.end.x,
      by: segment.end.y,
    }),
  );

  assert.equal(hit, near);
});

test("findClosestScreenSpaceSegment returns null when all segments exceed threshold", () => {
  const segment = makeSegment(0, [0, 0], [10, 0]);

  const hit = findClosestScreenSpaceSegment(
    [segment],
    200,
    200,
    25,
    (current) => ({
      ax: current.start.x,
      ay: current.start.y,
      bx: current.end.x,
      by: current.end.y,
    }),
  );

  assert.equal(hit, null);
});
