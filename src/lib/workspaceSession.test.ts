import test from "node:test";
import assert from "node:assert/strict";
import { resolveRestoredFrameIndex, sanitizeStoredWorkspaceSession } from "./workspaceSession.ts";

test("sanitizeStoredWorkspaceSession accepts a complete session snapshot", () => {
  assert.deepEqual(
    sanitizeStoredWorkspaceSession({
      filePath: "/tmp/demo.nc",
      frameIndex: 42,
      lineNumber: 43,
      playProgress: 42.5,
      cameraState: {
        target: { x: 1, y: 2, z: 3 },
        position: { x: 10, y: 20, z: 30 },
        zoom: 1.2,
        viewName: "Top",
      },
    }),
    {
      filePath: "/tmp/demo.nc",
      frameIndex: 42,
      lineNumber: 43,
      playProgress: 42.5,
      cameraState: {
        target: { x: 1, y: 2, z: 3 },
        position: { x: 10, y: 20, z: 30 },
        zoom: 1.2,
        viewName: "Top",
      },
    },
  );
});

test("sanitizeStoredWorkspaceSession tolerates missing camera state", () => {
  assert.deepEqual(
    sanitizeStoredWorkspaceSession({
      filePath: "/tmp/demo.nc",
      frameIndex: 4,
      lineNumber: 5,
      playProgress: 4,
    }),
    {
      filePath: "/tmp/demo.nc",
      frameIndex: 4,
      lineNumber: 5,
      playProgress: 4,
      cameraState: null,
    },
  );
});

test("sanitizeStoredWorkspaceSession rejects malformed session snapshots", () => {
  assert.equal(
    sanitizeStoredWorkspaceSession({
      filePath: "",
      frameIndex: -1,
      lineNumber: 2,
      playProgress: 0,
    }),
    null,
  );
});

test("resolveRestoredFrameIndex clamps to the last available frame", () => {
  assert.equal(resolveRestoredFrameIndex(180, { frameIndex: 999, playProgress: 150.8 }), 179);
});

test("resolveRestoredFrameIndex falls back to rounded progress when frame index is invalid", () => {
  assert.equal(resolveRestoredFrameIndex(180, { frameIndex: -1, playProgress: 56.2 }), 56);
});

test("resolveRestoredFrameIndex falls back to zero on empty inputs", () => {
  assert.equal(resolveRestoredFrameIndex(180, { frameIndex: NaN, playProgress: NaN }), 0);
});
