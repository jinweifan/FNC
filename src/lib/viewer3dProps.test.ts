import test from "node:test";
import assert from "node:assert/strict";
import type { CameraState, FrameState } from "../types";
import { areViewer3DPropsEqual, type Viewer3DProps } from "./viewer3dProps.ts";

const frame: FrameState = {
  index: 1,
  lineNumber: 2,
  position: { x: 1, y: 2, z: 3 },
  motion: "Linear",
  pausedByBreakpoint: false,
  axisDomain: "xyz",
};

const cameraState: CameraState = {
  target: { x: 0, y: 0, z: 0 },
  position: { x: 10, y: 10, z: 10 },
  zoom: 1,
  viewName: "Top",
};

function makeProps(): Viewer3DProps {
  const onFramePick = () => {};
  const onFrameHover = () => {};
  const onFrameHoverEnd = () => {};
  const onViewerHotkeyScopeChange = () => {};
  const onCameraStateChange = () => {};
  const onRefocusApplied = () => {};
  const onRequestNamedView = () => {};
  return {
    frames: [frame],
    codeLines: ["G1 X1"],
    currentFrame: frame,
    hoverFrame: null,
    cameraState,
    onFramePick,
    onFrameHover,
    onFrameHoverEnd,
    onViewerHotkeyScopeChange,
    onCameraStateChange,
    theme: "light",
    interactionMode: "pan",
    showGrid: true,
    showRapidPath: true,
    showPathTooltip: true,
    showOrientationGizmo: true,
    refocusNonce: 0,
    onRefocusApplied,
    fitOnResize: false,
    onRequestNamedView,
  };
}

test("areViewer3DPropsEqual returns true for stable references", () => {
  const props = makeProps();
  assert.equal(areViewer3DPropsEqual(props, props), true);
});

test("areViewer3DPropsEqual returns false when any Viewer3D input changes", () => {
  const prev = makeProps();
  const next = { ...prev, currentFrame: null };
  assert.equal(areViewer3DPropsEqual(prev, next), false);
});
