import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import type { SegmentRecord } from "./viewerSegments.ts";
import { buildViewerHoverInfo } from "./viewerHoverInfo.ts";

function makeFrame(index: number, lineNumber: number, motion: FrameState["motion"] = "Linear"): FrameState {
  return {
    index,
    lineNumber,
    position: { x: index, y: lineNumber, z: 0 },
    motion,
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

const segment: SegmentRecord = {
  start: { x: 0, y: 0, z: 0 },
  end: { x: 3, y: 4, z: 0 },
  endFrame: makeFrame(1, 2, "Rapid"),
  sourceIndex: 0,
  lane: "rapid",
};

test("buildViewerHoverInfo derives tooltip fields from segment and source line", () => {
  const info = buildViewerHoverInfo(segment, "G0 X3 Y4 F8000");

  assert.equal(info?.line, 2);
  assert.equal(info?.motionLabel, "G00");
  assert.equal(info?.isCurve, false);
  assert.equal(info?.length, 5);
  assert.equal(info?.chord, 5);
  assert.deepEqual(info?.words.map((word) => word.letter), ["G", "X", "Y", "F"]);
});

test("buildViewerHoverInfo returns null when no segment is provided", () => {
  assert.equal(buildViewerHoverInfo(null, "G1 X1"), null);
});
