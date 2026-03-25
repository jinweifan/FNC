import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolbarPrefs } from "./toolbarPrefs.ts";

test("sanitizeToolbarPrefs accepts a complete saved toolbar snapshot", () => {
  assert.deepEqual(
    sanitizeToolbarPrefs({
      speed: "High",
      interactionMode: "rotate",
      showRapidPath: false,
      showGrid: false,
      showOrientationGizmo: true,
      showPathTooltip: false,
    }),
    {
      speed: "High",
      interactionMode: "rotate",
      showRapidPath: false,
      showGrid: false,
      showOrientationGizmo: true,
      showPathTooltip: false,
    },
  );
});

test("sanitizeToolbarPrefs falls back when values are malformed", () => {
  assert.equal(
    sanitizeToolbarPrefs({
      speed: "Turbo",
      interactionMode: "orbit",
      showRapidPath: 1,
      showGrid: true,
      showOrientationGizmo: false,
      showPathTooltip: "yes",
    }),
    null,
  );
});
