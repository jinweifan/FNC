import test from "node:test";
import assert from "node:assert/strict";
import { computeAnchoredZoomState } from "./viewerZoom.ts";

test("computeAnchoredZoomState zooms position and target around anchor", () => {
  const result = computeAnchoredZoomState(
    { x: 10, y: 0, z: 10 },
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 },
    0.5,
    2,
    100,
  );

  assert.deepEqual(result.position, { x: 7.5, y: 0, z: 5 });
  assert.deepEqual(result.target, { x: 2.5, y: 0, z: 0 });
});

test("computeAnchoredZoomState clamps to min and max distance", () => {
  const zoomIn = computeAnchoredZoomState(
    { x: 10, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    0.1,
    4,
    100,
  );
  assert.deepEqual(zoomIn.position, { x: 4, y: 0, z: 0 });
  assert.deepEqual(zoomIn.target, { x: 0, y: 0, z: 0 });

  const zoomOut = computeAnchoredZoomState(
    { x: 10, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    20,
    4,
    30,
  );
  assert.deepEqual(zoomOut.position, { x: 30, y: 0, z: 0 });
  assert.deepEqual(zoomOut.target, { x: 0, y: 0, z: 0 });
});
