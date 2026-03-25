import test from "node:test";
import assert from "node:assert/strict";
import { clampPaneWidth, getPaneWidthBounds } from "./paneWidths.ts";

test("normal file pane keeps existing desktop drag range", () => {
  assert.deepEqual(getPaneWidthBounds({
    pane: "files",
    immersive: false,
    viewportWidth: 1440,
  }), { min: 160, max: 600 });
});

test("immersive file pane tightens width on compact windows", () => {
  assert.deepEqual(getPaneWidthBounds({
    pane: "files",
    immersive: true,
    viewportWidth: 960,
  }), { min: 240, max: 345 });
});

test("immersive editor pane preserves enough width on large windows", () => {
  assert.deepEqual(getPaneWidthBounds({
    pane: "editor",
    immersive: true,
    viewportWidth: 1600,
  }), { min: 360, max: 640 });
});

test("clampPaneWidth respects responsive minimums", () => {
  assert.equal(clampPaneWidth({
    pane: "editor",
    immersive: true,
    viewportWidth: 880,
    requested: 120,
  }), 280);
});

test("clampPaneWidth respects responsive maximums", () => {
  assert.equal(clampPaneWidth({
    pane: "files",
    immersive: true,
    viewportWidth: 1120,
    requested: 900,
  }), 403);
});
