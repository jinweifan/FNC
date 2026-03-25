import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import {
  buildViewerSceneData,
  buildViewerRenderBuffers,
  buildViewerPickCollections,
} from "./viewerSceneData.ts";

function makeFrame(
  index: number,
  lineNumber: number,
  position: [number, number, number],
  motion: FrameState["motion"],
  axisDomain: FrameState["axisDomain"] = "xyz",
): FrameState {
  return {
    index,
    lineNumber,
    position: { x: position[0], y: position[1], z: position[2] },
    motion,
    axisDomain,
    pausedByBreakpoint: false,
  };
}

test("buildViewerSceneData derives stable scene metadata from frames and code lines", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 5], "Rapid"),
    makeFrame(1, 2, [0, 0, 0], "Linear"),
    makeFrame(2, 3, [10, 0, 0], "Linear"),
    makeFrame(3, 4, [10, 4, 0], "Rapid"),
  ];

  const scene = buildViewerSceneData(frames, ["", "G1 Z0", "G1 X10", "G0 Y4"]);

  assert.equal(scene.segmentData.cutSegments.length, 2);
  assert.equal(scene.segmentData.rapidSegments.length, 1);
  assert.equal(scene.centerFrames.length, 4);
  assert.deepEqual(scene.geometryCenter, { x: 5, y: 2, z: 2.5 });
  assert.equal(scene.sceneScale, 80);
});

test("buildViewerRenderBuffers does not change cut buffers when only rapid visibility changes", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 0], "Linear"),
    makeFrame(1, 2, [10, 0, 0], "Linear"),
    makeFrame(2, 3, [10, 5, 0], "Rapid"),
  ];

  const scene = buildViewerSceneData(frames, ["G1 X0", "G1 X10", "G0 Y5"]);
  const compact = buildViewerRenderBuffers(scene.segmentData, false, (base) => base);
  const pointerDown = buildViewerRenderBuffers(scene.segmentData, true, (base) => base);

  assert.deepEqual(compact.cutPoints, pointerDown.cutPoints);
  assert.deepEqual(compact.uvwPoints, pointerDown.uvwPoints);
  assert.deepEqual(compact.plungePoints, pointerDown.plungePoints);
  assert.deepEqual(compact.rapidPoints, pointerDown.rapidPoints);
});

test("buildViewerPickCollections only expands combined picks when rapid path is visible", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 0], "Linear"),
    makeFrame(1, 2, [5, 0, 0], "Linear"),
    makeFrame(2, 3, [5, 5, 0], "Rapid"),
  ];

  const scene = buildViewerSceneData(frames, ["G1 X0", "G1 X5", "G0 Y5"]);
  const hidden = buildViewerPickCollections(scene.segmentData, false, (base) => base);
  const visible = buildViewerPickCollections(scene.segmentData, true, (base) => base);

  assert.equal(hidden.fullSegments.length, scene.segmentData.cutSegments.length);
  assert.equal(hidden.sampledSegments.length, hidden.pickCutSegments.length);
  assert.equal(visible.fullSegments.length, scene.segmentData.cutSegments.length + scene.segmentData.rapidSegments.length);
  assert.equal(visible.sampledSegments.length, visible.pickCutSegments.length + visible.pickRapidSegments.length);
  assert.equal(hidden.pickCutSegments, visible.pickCutSegments);
  assert.equal(hidden.pickRapidSegments, visible.pickRapidSegments);
});
