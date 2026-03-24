import test from "node:test";
import assert from "node:assert/strict";
import { buildViewerSegmentData } from "./viewerSegments.ts";
import type { FrameState } from "../types";

test("buildViewerSegmentData reuses cut segment objects in render lanes", () => {
  const frames: FrameState[] = [
    { index: 0, lineNumber: 1, position: { x: 0, y: 0, z: 5 }, motion: "Rapid", pausedByBreakpoint: false, axisDomain: "xyz" },
    { index: 1, lineNumber: 2, position: { x: 0, y: 0, z: 0 }, motion: "Linear", pausedByBreakpoint: false, axisDomain: "xyz" },
    { index: 2, lineNumber: 3, position: { x: 5, y: 0, z: 0 }, motion: "Linear", pausedByBreakpoint: false, axisDomain: "xyz" },
  ];

  const data = buildViewerSegmentData(frames, ["", "G1 Z0", "G1 X5"]);

  assert.equal(data.cutSegments.length, 2);
  assert.equal(data.plungeRenderSegments.length, 1);
  assert.equal(data.cutRenderSegments.length, 1);
  assert.equal(data.plungeRenderSegments[0], data.cutSegments[0]);
  assert.equal(data.cutRenderSegments[0], data.cutSegments[1]);
});

test("buildViewerSegmentData keeps rapid plunge pickable without cloning render segments", () => {
  const frames: FrameState[] = [
    { index: 0, lineNumber: 1, position: { x: 0, y: 0, z: 5 }, motion: "Rapid", pausedByBreakpoint: false, axisDomain: "xyz" },
    { index: 1, lineNumber: 2, position: { x: 0, y: 0, z: 0 }, motion: "Rapid", pausedByBreakpoint: false, axisDomain: "xyz" },
  ];

  const data = buildViewerSegmentData(frames, ["", "G0 Z0"]);

  assert.equal(data.rapidSegments.length, 1);
  assert.equal(data.plungeRenderSegments.length, 1);
  assert.equal(data.cutSegments.length, 1);
  assert.equal(data.rapidRenderSegments[0], data.rapidSegments[0]);
  assert.equal(data.plungeRenderSegments[0], data.cutSegments[0]);
  assert.notEqual(data.cutSegments[0], data.rapidSegments[0]);
});
