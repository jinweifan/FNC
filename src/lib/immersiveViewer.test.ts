import test from "node:test";
import assert from "node:assert/strict";
import { enterImmersivePanes, exitImmersivePanes, toggleImmersiveDrawer } from "./immersiveViewer.ts";

test("enterImmersivePanes keeps viewer visible and collapses side panes", () => {
  assert.deepEqual(
    enterImmersivePanes({ showFiles: true, showEditor: true, showViewer: false }),
    { showFiles: false, showEditor: false, showViewer: true },
  );
});

test("toggleImmersiveDrawer opens one drawer at a time", () => {
  assert.deepEqual(
    toggleImmersiveDrawer({ showFiles: false, showEditor: true, showViewer: true }, "files"),
    { showFiles: true, showEditor: false, showViewer: true },
  );
  assert.deepEqual(
    toggleImmersiveDrawer({ showFiles: true, showEditor: false, showViewer: true }, "files"),
    { showFiles: false, showEditor: false, showViewer: true },
  );
});

test("exitImmersivePanes preserves current overlays and keeps viewer visible", () => {
  assert.deepEqual(
    exitImmersivePanes({ showFiles: true, showEditor: false, showViewer: true }),
    { showFiles: true, showEditor: false, showViewer: true },
  );
});
