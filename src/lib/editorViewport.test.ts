import test from "node:test";
import assert from "node:assert/strict";

import { resolveMeasuredEditorViewport } from "./editorViewport.ts";

test("uses the latest measured width when the editor shrinks after growing", () => {
  const grown = resolveMeasuredEditorViewport({ width: 920, height: 640 });
  const shrunk = resolveMeasuredEditorViewport({ width: 280, height: 640 });

  assert.deepEqual(grown, { width: 920, height: 640, widthStyle: "920px", heightStyle: "640px" });
  assert.deepEqual(shrunk, { width: 280, height: 640, widthStyle: "280px", heightStyle: "640px" });
});

test("drops invalid measurements instead of reusing stale dimensions", () => {
  assert.equal(resolveMeasuredEditorViewport({ width: 0, height: 640 }), null);
  assert.equal(resolveMeasuredEditorViewport({ width: 280, height: 0 }), null);
});
